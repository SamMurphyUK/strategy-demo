extends Resource
class_name AmphibiousDesignationResource

@export var command_id: String = ""
@export var faction_id: String = ""
@export var transport_instance_id: String = ""
@export var origin_sea_zone_id: String = ""
@export var target_region_id: String = ""


static func from_command(cmd: Command) -> AmphibiousDesignationResource:
	var designation := AmphibiousDesignationResource.new()
	designation.command_id = cmd.command_id
	designation.faction_id = cmd.player_id
	designation.transport_instance_id = str(cmd.payload.get("transport_instance_id", ""))
	designation.origin_sea_zone_id = str(cmd.payload.get("origin_sea_zone_id", ""))
	designation.target_region_id = str(cmd.payload.get("target_region_id", ""))
	return designation


func to_payload() -> Dictionary:
	return {
		"transport_instance_id": transport_instance_id,
		"origin_sea_zone_id": origin_sea_zone_id,
		"target_region_id": target_region_id,
	}
