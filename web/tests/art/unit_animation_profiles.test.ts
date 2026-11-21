import { describe, expect, it } from "vitest";
import { foldLayerShift, resolveUnitAnimProfile, UNIT_ANIM_PROFILES } from "../../src/art/unitAnimationProfiles";
import { createVehicleAnim, easeVehicle, tickVehicle, vehicleOffsets } from "../../src/art/vehicleMotion";

describe("unit animation profiles", () => {
  it("maps faction ids, roster names, and QUICK menu values onto the archetype", () => {
    expect(resolveUnitAnimProfile("walk:ger_tank_seed1_QUICK:vector").id).toBe("tank");
    expect(resolveUnitAnimProfile("walk:ger_fighter_seed1_QUICK:rig").id).toBe("fighter");
    expect(resolveUnitAnimProfile("ussr_mech_infantry_seed1_QUICK").id).toBe("mech_inf");
    expect(resolveUnitAnimProfile("jap_aaa_seed1").id).toBe("aa_gun");
    expect(resolveUnitAnimProfile("idle:uk_tac_bomber_seed1_QUICK").id).toBe("tac_bomber");
    expect(resolveUnitAnimProfile("usa_bomber_seed1").id).toBe("strat_bomber");
    expect(resolveUnitAnimProfile("us_fighter_seed1_QUICK").id).toBe("fighter");
    expect(resolveUnitAnimProfile("fire:GER_battleship_seed1_QUICK").id).toBe("battleship");
    expect(resolveUnitAnimProfile("uk_cruiser_seed1").id).toBe("cruiser");
    expect(resolveUnitAnimProfile("jap_destroyer_seed1_QUICK").id).toBe("destroyer");
    expect(resolveUnitAnimProfile("ussr_submarine_seed1").id).toBe("submarine");
    expect(resolveUnitAnimProfile("uk_transport_seed1").id).toBe("transport");
    expect(resolveUnitAnimProfile("artillery").id).toBe("artillery");
    expect(resolveUnitAnimProfile("aa").id).toBe("aa_gun");
    expect(resolveUnitAnimProfile("armor").id).toBe("tank");
    expect(resolveUnitAnimProfile("tactical_bomber").id).toBe("tac_bomber");
    expect(resolveUnitAnimProfile("strategic_bomber").id).toBe("strat_bomber");
    expect(resolveUnitAnimProfile("jap_infantry").id).toBe("tank");
    expect(resolveUnitAnimProfile("").id).toBe("tank");
  });

  it("rattles a towed gun as one piece and drops the spade when it stops", () => {
    const profile = UNIT_ANIM_PROFILES.artillery;
    const moving = createVehicleAnim("moving");
    tickVehicle(moving, "moving", () => 0, profile);
    expect(moving.bumpStyle).toBe("rigid");
    expect(moving.bumpDir).toBe(-1);
    const bumped = vehicleOffsets(moving, profile);
    expect(bumped.torso.y).toBe(-1);
    expect(bumped.head.y).toBe(-1);
    expect(bumped.weapon.y).toBe(-1);
    expect(bumped.tracks).toEqual({ x: 0, y: 0 });

    tickVehicle(moving, "moving", () => {
      throw new Error("the rattle holds for one tick");
    }, profile);
    expect(vehicleOffsets(moving, profile).torso).toEqual({ x: 0, y: 0 });

    const idle = createVehicleAnim("idle");
    tickVehicle(idle, "idle", () => 0, profile);
    expect(idle.bumpTimer).toBe(0);

    const halted = createVehicleAnim("moving");
    tickVehicle(halted, "idle", () => 0, profile);
    expect(halted.lunge).toBe(1);
    expect(vehicleOffsets(halted, profile).torso).toEqual({ x: 1, y: 1 });
    expect(vehicleOffsets(halted, profile).weapon).toEqual({ x: 1, y: 1 });
  });

  it("pitches an attacking fighter and keeps the loiter wave off the root while it moves", () => {
    const profile = UNIT_ANIM_PROFILES.fighter;
    const moving = createVehicleAnim("moving");
    const run = vehicleOffsets(moving, profile);
    expect(run.head.y).toBe(1);
    expect(run.weapon.y).toBe(1);
    expect(run.root.y).toBe(0);

    const idle = createVehicleAnim("idle");
    idle.wave = 2;
    expect(vehicleOffsets(idle, profile).root.y).toBeCloseTo(1);

    tickVehicle(moving, "idle", () => 0, profile);
    expect(moving.lunge).toBe(0);

    const firing = createVehicleAnim("firing");
    tickVehicle(firing, "firing", () => {
      throw new Error("a fixed kick does not roll");
    }, profile);
    expect(firing.recoilX).toBe(-1);
    expect(firing.frame).toBe(1);
    tickVehicle(firing, "firing", () => {
      throw new Error("frame 2 is between bursts");
    }, profile);
    expect(firing.frame).toBe(2);
    expect(firing.recoilX).toBe(-1);
    tickVehicle(firing, "firing", () => {
      throw new Error("frame 3 uses the fixed kick");
    }, profile);
    expect(firing.frame).toBe(3);
    expect(firing.recoilX).toBe(-1);
  });

  it("lifts a tactical bomber for 300ms and a strategic bomber for one frame", () => {
    const tactical = createVehicleAnim("firing");
    tickVehicle(tactical, "firing", () => 0, UNIT_ANIM_PROFILES.tac_bomber);
    expect(tactical.liftY).toBe(-2);
    expect(vehicleOffsets(tactical, UNIT_ANIM_PROFILES.tac_bomber).root.y).toBe(-2);
    easeVehicle(tactical, 0.15);
    expect(tactical.liftY).toBeCloseTo(-1);
    easeVehicle(tactical, 0.15);
    expect(tactical.liftY).toBe(0);

    const strategic = createVehicleAnim("firing");
    strategic.wave = 4;
    tickVehicle(strategic, "firing", () => 0, UNIT_ANIM_PROFILES.strat_bomber);
    expect(vehicleOffsets(strategic, UNIT_ANIM_PROFILES.strat_bomber).root.y).toBe(-1);
    tickVehicle(strategic, "firing", () => 0, UNIT_ANIM_PROFILES.strat_bomber);
    expect(vehicleOffsets(strategic, UNIT_ANIM_PROFILES.strat_bomber).root.y).toBe(0);
  });

  it("kicks a battleship, then lets the superstructure lag, and heaves a cruiser more slowly when damaged", () => {
    const ship = createVehicleAnim("firing");
    tickVehicle(ship, "firing", () => {
      throw new Error("the broadside is a fixed kick");
    }, UNIT_ANIM_PROFILES.battleship);
    expect(ship.recoilX).toBe(-3);
    expect(vehicleOffsets(ship, UNIT_ANIM_PROFILES.battleship).weapon.x).toBe(-3);
    expect(vehicleOffsets(ship, UNIT_ANIM_PROFILES.battleship).head.x).toBe(0);
    tickVehicle(ship, "firing", () => {
      throw new Error("the lag frame does not roll");
    }, UNIT_ANIM_PROFILES.battleship);
    expect(ship.frame).toBe(2);
    expect(vehicleOffsets(ship, UNIT_ANIM_PROFILES.battleship).head.x).toBe(-1);
    expect(vehicleOffsets(ship, UNIT_ANIM_PROFILES.battleship).weapon.x).toBe(0);

    const cruiser = createVehicleAnim("idle");
    cruiser.damaged = true;
    cruiser.wave = 6;
    expect(vehicleOffsets(cruiser, UNIT_ANIM_PROFILES.cruiser).root.y).toBeCloseTo(1);
    expect(vehicleOffsets(cruiser, UNIT_ANIM_PROFILES.cruiser).torso.y).toBe(2);
    expect(vehicleOffsets(cruiser, UNIT_ANIM_PROFILES.cruiser).head).toEqual({ x: -1, y: 2 });
  });

  it("holds a damaged flak barrel two extra ticks and sinks a moving submarine", () => {
    const gun = createVehicleAnim("firing");
    gun.damaged = true;
    tickVehicle(gun, "firing", () => 0, UNIT_ANIM_PROFILES.aa_gun);
    expect(vehicleOffsets(gun, UNIT_ANIM_PROFILES.aa_gun).weapon).toEqual({ x: -2, y: 3 });
    expect(vehicleOffsets(gun, UNIT_ANIM_PROFILES.aa_gun).head).toEqual({ x: -2, y: 3 });
    tickVehicle(gun, "firing", () => 0, UNIT_ANIM_PROFILES.aa_gun);
    expect(gun.frame).toBe(2);
    expect(vehicleOffsets(gun, UNIT_ANIM_PROFILES.aa_gun).weapon).toEqual({ x: -2, y: 3 });
    expect(vehicleOffsets(gun, UNIT_ANIM_PROFILES.aa_gun).head.x).toBe(0);
    tickVehicle(gun, "firing", () => 0, UNIT_ANIM_PROFILES.aa_gun);
    expect(vehicleOffsets(gun, UNIT_ANIM_PROFILES.aa_gun).weapon.x).toBe(-2);
    tickVehicle(gun, "firing", () => 0, UNIT_ANIM_PROFILES.aa_gun);
    expect(gun.frame).toBe(4);
    expect(vehicleOffsets(gun, UNIT_ANIM_PROFILES.aa_gun).weapon.x).toBe(0);

    const boat = createVehicleAnim("moving");
    const sunk = vehicleOffsets(boat, UNIT_ANIM_PROFILES.submarine);
    expect(sunk.torso.y).toBe(2);
    expect(sunk.head.y).toBe(2);
    expect(sunk.weapon.y).toBe(2);
    boat.mode = "idle";
    expect(vehicleOffsets(boat, UNIT_ANIM_PROFILES.submarine).torso.y).toBe(0);
  });

  it("sags a damaged tank, raises its march bump, and hitches the hull every fourth frame", () => {
    const profile = UNIT_ANIM_PROFILES.tank;
    const quiet = createVehicleAnim("moving");
    tickVehicle(quiet, "moving", () => 0.3, profile);
    expect(quiet.bumpTimer).toBe(0);

    const rough = createVehicleAnim("moving");
    rough.damaged = true;
    tickVehicle(rough, "moving", () => 0.36, profile);
    expect(rough.bumpTimer).toBe(0);
    rough.frame = 0;
    const hitch = vehicleOffsets(rough, profile);
    expect(hitch.torso).toEqual({ x: -1, y: 1 });
    expect(hitch.head.y).toBe(1);
    expect(hitch.weapon.y).toBe(1);
    rough.frame = 1;
    expect(vehicleOffsets(rough, profile).torso.x).toBe(0);

    const again = createVehicleAnim("moving");
    again.damaged = true;
    tickVehicle(again, "moving", () => 0.34, profile);
    expect(again.bumpTimer).toBe(2);
  });

  it("stutters a mechanised gun on the first and fourth fire frames", () => {
    const profile = UNIT_ANIM_PROFILES.mech_inf;
    const anim = createVehicleAnim("firing");
    tickVehicle(anim, "firing", () => 0, profile);
    expect(anim.recoilX).toBe(-1);
    expect(vehicleOffsets(anim, profile).weapon.x).toBe(-2);
    tickVehicle(anim, "firing", () => 1, profile);
    tickVehicle(anim, "firing", () => 1, profile);
    expect(anim.frame).toBe(3);
    expect(anim.recoilX).toBe(-1);
    tickVehicle(anim, "firing", () => 1, profile);
    expect(anim.frame).toBe(4);
    expect(anim.recoilX).toBe(-2);
    expect(vehicleOffsets(anim, profile).weapon.x).toBe(-2);
  });

  it("slides each kick on the layer that holds the ink", () => {
    const artillery = createVehicleAnim("firing");
    tickVehicle(artillery, "firing", () => 0, UNIT_ANIM_PROFILES.artillery);
    const gun = foldLayerShift(UNIT_ANIM_PROFILES.artillery, vehicleOffsets(artillery, UNIT_ANIM_PROFILES.artillery));
    expect(gun.head).toEqual({ x: -4, y: 0 });
    expect(gun.torso.y).toBe(-1);
    expect(gun.weapon).toEqual({ x: 0, y: 0 });

    const flak = createVehicleAnim("firing");
    tickVehicle(flak, "firing", () => 0, UNIT_ANIM_PROFILES.aa_gun);
    expect(foldLayerShift(UNIT_ANIM_PROFILES.aa_gun, vehicleOffsets(flak, UNIT_ANIM_PROFILES.aa_gun)).head).toEqual({ x: -2, y: 2 });

    const pitched = foldLayerShift(UNIT_ANIM_PROFILES.fighter, vehicleOffsets(createVehicleAnim("moving"), UNIT_ANIM_PROFILES.fighter));
    expect(pitched.tracks.y).toBe(1);
    expect(pitched.torso.y).toBe(1);
    expect(pitched.head).toEqual({ x: 0, y: 0 });

    const ship = createVehicleAnim("firing");
    tickVehicle(ship, "firing", () => 0, UNIT_ANIM_PROFILES.battleship);
    const salvo = foldLayerShift(UNIT_ANIM_PROFILES.battleship, vehicleOffsets(ship, UNIT_ANIM_PROFILES.battleship));
    expect(salvo.torso.x).toBe(-3);
    expect(salvo.weapon).toEqual({ x: 0, y: 0 });

    const tank = createVehicleAnim("firing");
    tickVehicle(tank, "firing", () => 0, UNIT_ANIM_PROFILES.tank);
    const barrel = foldLayerShift(UNIT_ANIM_PROFILES.tank, vehicleOffsets(tank, UNIT_ANIM_PROFILES.tank));
    expect(barrel.weapon.x).toBe(-3);
    expect(barrel.head).toEqual({ x: 0, y: 0 });
  });
});
