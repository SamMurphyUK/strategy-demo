extends SceneTree

## Headless demo smoke runner. Writes user://smoke_result.json (or path from --output=).

const OUTPUT_ARG_PREFIX := "--output="
const SEED_ARG_PREFIX := "--seed="

var _output_path := "user://smoke_result.json"
var _seed := 12345
var _errors: Array = []
var _events: Array = []


func _initialize() -> void:
	_parse_args()
	call_deferred("_run_smoke")


func _parse_args() -> void:
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with(OUTPUT_ARG_PREFIX):
			_output_path = arg.substr(OUTPUT_ARG_PREFIX.length())
		elif arg.begins_with(SEED_ARG_PREFIX):
			_seed = int(arg.substr(SEED_ARG_PREFIX.length()))


func _run_smoke() -> void:
	var result := {
		"success": false,
		"seed": _seed,
		"errors": [],
		"event_types": [],
		"events": [],
		"snapshot_phase": "",
		"placed_infantry": false,
	}

	var stub := GameSessionStub.new()
	stub.initialize_demo(_seed)

	var purchase := stub.apply_command({
		"command_id": "smoke_purchase",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	})
	_collect(purchase)

	if str(purchase.get("result_type", "")) != "ok":
		_errors.append("Purchase failed: %s" % str(purchase.get("error", {})))

	for i in 3:
		var ep := stub.apply_command({
			"command_id": "smoke_ep_%d" % i,
			"player_id": "allies",
			"type": "end_phase",
			"payload": {},
		})
		_collect(ep)

	var region_id := _first_allies_factory(stub)
	var place := stub.apply_command({
		"command_id": "smoke_place",
		"player_id": "allies",
		"type": "place_units",
		"payload": {
			"placements": [{
				"region_id": region_id,
				"units": [{"unit_type_id": "infantry", "count": 1}],
			}],
		},
	})
	_collect(place)

	if str(place.get("result_type", "")) != "ok":
		_errors.append("Place failed: %s" % str(place.get("error", {})))

	var end_mob := stub.apply_command({
		"command_id": "smoke_ep_mob",
		"player_id": "allies",
		"type": "end_phase",
		"payload": {},
	})
	_collect(end_mob)

	var end_turn := stub.apply_command({
		"command_id": "smoke_end_turn",
		"player_id": "allies",
		"type": "end_turn",
		"payload": {},
	})
	_collect(end_turn)

	var snap := stub.get_state()
	var placed := _region_has_infantry(snap, region_id)
	var has_units_placed := _event_types().has("unitsplaced")

	result["errors"] = _errors.duplicate()
	result["event_types"] = _event_types().keys()
	result["events"] = _events.duplicate(true)
	result["snapshot_phase"] = str(snap.get("turn_info", {}).get("current_phase", ""))
	result["placed_infantry"] = placed
	result["success"] = (
		_errors.is_empty()
		and has_units_placed
		and placed
	)

	_write_result(result)
	quit(0 if result["success"] else 1)


func _collect(res: Dictionary) -> void:
	for evt in res.get("events", []):
		_events.append(evt)


func _event_types() -> Dictionary:
	var types := {}
	for evt in _events:
		types[str(evt.get("type", ""))] = true
	return types


func _first_allies_factory(stub: GameSessionStub) -> String:
	for rid in stub.state.regions.keys():
		var r: Region = stub.state.regions[rid]
		if r.owner_faction_id == "allies" and r.has_factory:
			return rid
	return "region_1"


func _region_has_infantry(snap: Dictionary, region_id: String) -> bool:
	for region_entry in snap.get("regions", []):
		if str(region_entry.get("region_id", "")) != region_id:
			continue
		for u in region_entry.get("units", []):
			if str(u.get("unit_type_id", "")) == "infantry":
				return int(u.get("count", 0)) > 0
	return false


func _write_result(result: Dictionary) -> void:
	var json := JSON.stringify(result, "\t")
	var path := _output_path
	if path.begins_with("user://"):
		var file := FileAccess.open(path, FileAccess.WRITE)
		if file:
			file.store_string(json)
			file.close()
		print("Smoke result written to ", path)
	else:
		var f := FileAccess.open(path, FileAccess.WRITE)
		if f:
			f.store_string(json)
			f.close()
	print(json)
