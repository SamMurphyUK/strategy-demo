// The live demomap01.json is the blank slicing board. These tests still need the populated campaign.
import campaign from "../fixtures/campaign_demomap.json";
import { GameSessionStub } from "../../src/engine";
import type { Dict } from "../../src/engine/model/types";

export function campaignSession(seed = 12345): GameSessionStub {
  const session = new GameSessionStub();
  session.initializeFromMap(campaign as Dict, seed);
  return session;
}
