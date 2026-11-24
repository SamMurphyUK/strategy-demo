// The live demomap01.json is the blank slicing board. These tests still need the populated campaign.
import campaign from "../fixtures/campaign_demomap.json";
import { GameSession } from "../../src/engine";
import type { Dict } from "../../src/engine/model/types";

export function campaignSession(seed = 12345): GameSession {
  const session = new GameSession();
  session.initializeFromMap(campaign as Dict, seed);
  return session;
}
