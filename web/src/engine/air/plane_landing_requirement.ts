export class PlaneLandingRequirement {
  unit_instance_id: string;
  current_region_id: string;
  movement_spent: number;
  required_landing = true;
  possible_landing_regions: string[] = [];
  dependent_carrier_ids: string[] = [];

  constructor(unitId = "", regionId = "", movement = 0) {
    this.unit_instance_id = unitId;
    this.current_region_id = regionId;
    this.movement_spent = movement;
  }
}
