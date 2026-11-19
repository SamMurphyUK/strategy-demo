import { useDeferredValue, useMemo, useRef, useState } from "react";
import { layerLabel } from "./archetypeLayers";
import { SentPicture, imageRgba, loadImage, money, pngBase64, type EditorHint } from "./editorShared";
import { withEditingLayer, type CellMask, type UnitPaintDocument } from "./pixelPaint";
import type { SpriteFrameGrid } from "./skeletonSchema";
import { FACTION_MILITARY_MAPPINGS } from "./starterParts";
import { GridThumb } from "./VehiclePartsPanel";
import { VEHICLE_GEN_ROOMS, harvestVehiclePart, planVehiclePart, type VehicleGenPlan } from "./vehiclePartGen";
import { PART_NAME_LIMIT, addVehiclePart, partPreview } from "./vehicleParts";

const GENERATE_URL = "/__dev/generate-part";

/** A part that came back from Retro Diffusion and has not been kept yet. */
interface Candidate {
  key: number;
  layer: string;
  name: string;
  seed: number;
  grid: SpriteFrameGrid;
  cost: number;
  path: string;
}

interface Quote {
  cost: number;
  seconds: number | null;
}

/**
 * Generate a part for the open layer of a vehicle. It is the vehicle editor's copy of the infantry
 * editor's Generate section: say what to draw, check the price for free, and Generate asks before
 * it spends anything. What comes back waits on a shelf until it is kept as a part.
 */
export function VehicleGeneratePanel({
  doc,
  selection,
  onChange,
  hint,
}: {
  doc: UnitPaintDocument;
  /** The box or lasso selection on the canvas, if there is one. */
  selection: CellMask | null;
  onChange: (next: UnitPaintDocument, note: string) => void;
  hint: EditorHint;
}) {
  const [prompt, setPrompt] = useState("");
  const [seed, setSeed] = useState(1);
  const [room, setRoom] = useState<number>(4);
  const [busy, setBusy] = useState<"" | "price" | "paint">("");
  const [note, setNote] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const keyRef = useRef(0);
  const docRef = useRef(doc);
  docRef.current = doc;
  // The picture to send is worked out a moment after the pencil, so painting a large plate stays smooth.
  const settled = useDeferredValue(doc);
  const layer = settled.editingLayer ?? "";
  const label = layerLabel(settled.archetype, layer);
  const lower = label.toLowerCase();
  const planned = useMemo((): { plan: VehicleGenPlan | null; error: string } => {
    try {
      return { plan: planVehiclePart(settled, { layer, room, selection }), error: "" };
    } catch (error) {
      return { plan: null, error: error instanceof Error ? error.message : String(error) };
    }
  }, [settled, layer, room, selection]);
  const mapping = FACTION_MILITARY_MAPPINGS[settled.blueprint.factionId];
  const unitId = `${settled.blueprint.factionId.toLowerCase()}_${settled.blueprint.unitTypeId}`;
  const { width: canvasW, height: canvasH } = settled.blueprint.canvasSize;
  const tried = useMemo(
    () =>
      candidates.map((candidate) => ({
        candidate,
        pixels:
          candidate.grid.length === canvasH && (candidate.grid[0]?.length ?? 0) === canvasW
            ? partPreview(settled, candidate.layer, candidate.grid)
            : null,
      })),
    [candidates, settled, canvasW, canvasH],
  );

  /** Post the picture and its mask to the dev server. A dry run asks the price and spends nothing. */
  const send = async (plan: VehicleGenPlan, extra: { dryRunOnly: true } | { agreedCost: number }) => {
    const response = await fetch(GENERATE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unitId,
        layer: plan.layer,
        prompt: prompt.trim(),
        seed,
        inputBase64: await pngBase64(plan.input, plan.width, plan.height),
        maskBase64: await pngBase64(plan.mask, plan.width, plan.height),
        ...extra,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      cost?: number | null;
      seconds?: number | null;
      path?: string;
      mime?: string;
      base64?: string;
    };
    if (!response.ok || json.ok === false) {
      throw new Error(json.error || `The dev server answered ${response.status}.`);
    }
    return json;
  };

  const askPrice = async (plan: VehicleGenPlan): Promise<Quote> => {
    const json = await send(plan, { dryRunOnly: true });
    if (typeof json.cost !== "number") {
      throw new Error("Retro Diffusion gave no price.");
    }
    const asked = { cost: json.cost, seconds: json.seconds ?? null };
    setQuote(asked);
    return asked;
  };

  const ready = (): VehicleGenPlan | null => {
    if (!planned.plan) {
      setNote(planned.error);
      return null;
    }
    if (prompt.trim() === "") {
      setNote("Say what to draw first.");
      return null;
    }
    if (!Number.isSafeInteger(seed) || seed < 0) {
      setNote("The seed must be a whole number.");
      return null;
    }
    return planned.plan;
  };

  const checkPrice = async () => {
    const plan = ready();
    if (!plan) {
      return;
    }
    setBusy("price");
    try {
      const asked = await askPrice(plan);
      setNote(`Asked the price: ${money(asked.cost)} for 1 picture. Nothing was spent.`);
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy("");
    }
  };

  const generate = async () => {
    const snapshot = settled;
    const plan = ready();
    if (!plan) {
      return;
    }
    let kept = "";
    setBusy("price");
    try {
      const asked = await askPrice(plan);
      const wait = asked.seconds ? ` It takes about ${Math.round(asked.seconds)} seconds.` : "";
      if (!window.confirm(`This spends ${money(asked.cost)} of Retro Diffusion credit for 1 picture.${wait} Go ahead?`)) {
        setNote("Nothing was sent, and nothing was spent.");
        return;
      }
      setBusy("paint");
      setNote("Waiting for the picture. Keep this page open.");
      const json = await send(plan, { agreedCost: asked.cost });
      const cost = json.cost ?? asked.cost;
      kept = json.path ? `web/${json.path}` : "";
      const image = await loadImage(`data:${json.mime ?? "image/png"};base64,${json.base64 ?? ""}`);
      const result = harvestVehiclePart(snapshot, plan, { rgba: imageRgba(image), width: image.naturalWidth, height: image.naturalHeight });
      keyRef.current += 1;
      const tag = ` (seed ${seed})`;
      const candidate: Candidate = {
        key: keyRef.current,
        layer: plan.layer,
        name: `${prompt.trim().slice(0, PART_NAME_LIMIT - tag.length)}${tag}`,
        seed,
        grid: result.grid,
        cost,
        path: kept,
      };
      setCandidates((list) => [...list, candidate]);
      setSeed((value) => value + 1);
      setNote(
        `Seed ${candidate.seed} came back for ${money(cost)}: ${result.painted} pixels read${result.cleared > 0 ? `, ${result.cleared} left empty` : ""}. The picture is at ${kept}. The seed moved on, so Generate again gives a different one.`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setNote(kept !== "" ? `${message} What was paid for is kept at ${kept}.` : message);
    } finally {
      setBusy("");
    }
  };

  const keep = (candidate: Candidate) => {
    try {
      const next = withEditingLayer(addVehiclePart(docRef.current, candidate.layer, candidate.name, candidate.grid), candidate.layer);
      setCandidates((list) => list.filter((item) => item.key !== candidate.key));
      onChange(
        next,
        `“${candidate.name}” is in the parts and the ${layerLabel(next.archetype, candidate.layer).toLowerCase()} is wearing it. Save into the project writes it to disk.`,
      );
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    }
  };

  const open = planned.plan
    ? planned.plan.fromSelection
      ? `The ${planned.plan.open} selected pixels are open to repainting.`
      : `The ${lower} being worn and ${room} pixels around it are open to repainting. Select an area with Box or Lasso to open that instead.`
    : "";

  return (
    <section className="editor-panel editor-gen" aria-label="Generate a part">
      <h3>Generate a {lower} part</h3>
      <p className="editor-note">
        The Idle pose is sent at its own size, up to the {lower}, with the layers above it taken off. {open} What comes back is matched to
        this country&apos;s seven colours, so the words change the shape. Colours of changes the hue.
      </p>
      <div className="editor-row">
        <label>
          What to draw
          <input
            type="text"
            className="editor-wide"
            aria-label="What to draw"
            placeholder={`Describe the ${lower}`}
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>
        <label>
          Seed
          <input
            type="number"
            aria-label="Seed"
            min={0}
            step={1}
            value={seed}
            {...hint("The same words and the same seed give much the same picture. It moves on by one after each picture.")}
            onChange={(event) => setSeed(Math.round(Number(event.target.value)))}
          />
        </label>
        <label>
          Room
          <select
            aria-label="Room around the part"
            value={room}
            disabled={planned.plan?.fromSelection === true}
            {...hint("How many pixels past the worn part the new one may reach. More room lets the shape change more. A selection is used as it is.")}
            onChange={(event) => setRoom(Number(event.target.value))}
          >
            {VEHICLE_GEN_ROOMS.map((value) => (
              <option key={value} value={value}>
                {value} px
              </option>
            ))}
          </select>
        </label>
        <button type="button" disabled={busy !== ""} {...hint("Ask Retro Diffusion what this costs. Asking is free.")} onClick={() => void checkPrice()}>
          {busy === "price" ? "Asking…" : "Check the price"}
        </button>
        <button
          type="button"
          disabled={busy !== ""}
          {...hint("Send the picture to Retro Diffusion. It shows the price and asks before it spends anything.")}
          onClick={() => void generate()}
        >
          {busy === "paint" ? "Waiting for Retro Diffusion…" : "Generate"}
        </button>
      </div>
      <p className="editor-note">
        {planned.plan
          ? quote
            ? `${money(quote.cost)} a picture.`
            : "This is 1 picture. Checking the price is free, and Generate asks before it spends anything."
          : planned.error}
      </p>
      {note !== "" && (
        <p className="editor-note" role="status">
          {note}
        </p>
      )}
      {planned.plan && <SentPicture sheet={planned.plan} />}
      {candidates.length > 0 && (
        <div className="editor-shelf" role="group" aria-label="Generated parts">
          {tried.map(({ candidate, pixels }) => (
            <div key={candidate.key} className="editor-candidate">
              {pixels ? <GridThumb grid={pixels} mapping={mapping} /> : <small>Drawn for another canvas size.</small>}
              <small>
                {layerLabel(settled.archetype, candidate.layer)}: {candidate.name}
              </small>
              <button
                type="button"
                {...hint("Add it to the parts under this name and wear it. Ctrl+Z takes it out again.")}
                onClick={() => keep(candidate)}
              >
                Keep as a part
              </button>
              <button
                type="button"
                {...hint(`Drop it from this list. The picture stays at ${candidate.path}.`)}
                onClick={() => setCandidates((list) => list.filter((item) => item.key !== candidate.key))}
              >
                Discard
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
