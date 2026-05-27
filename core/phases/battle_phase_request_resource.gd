extends Resource
class_name BattlePhaseRequestResource

@export var faction_id: String = ""


static func from_faction(faction_id: String) -> BattlePhaseRequestResource:
	var request := BattlePhaseRequestResource.new()
	request.faction_id = faction_id
	return request
