class_name EventSchemaValidator
extends RefCounted

const SCHEMA_PATH := "res://docs/event_schema.json"

var _schema: Dictionary = {}
var errors: Array = []


static func validate_event(evt: Dictionary, schema: Dictionary = {}) -> bool:
	var v := EventSchemaValidator.new()
	if schema.is_empty():
		v._schema = v._load_schema()
	else:
		v._schema = schema
	return v._validate(evt)


static func validate_events(events: Array) -> bool:
	for evt in events:
		if not validate_event(evt):
			return false
	return true


func get_errors() -> Array:
	return errors


func _load_schema() -> Dictionary:
	var data := GameSessionFactory.load_json(SCHEMA_PATH)
	return data if not data.is_empty() else {}


func _validate(evt: Dictionary) -> bool:
	errors.clear()
	if _schema.is_empty():
		_schema = _load_schema()
	if _schema.is_empty():
		errors.append("Schema not loaded")
		return false

	var required: Array = _schema.get("required", [])
	for key in required:
		if not evt.has(key):
			errors.append("Missing required field: %s" % key)
			return false

	var props: Dictionary = _schema.get("properties", {})

	if props.has("event_id"):
		var eid := str(evt.get("event_id", ""))
		var pattern := str(props["event_id"].get("pattern", ""))
		if not pattern.is_empty():
			var regex := RegEx.new()
			if regex.compile(pattern) == OK and regex.search(eid) == null:
				errors.append("event_id does not match pattern: %s" % eid)
				return false

	if props.has("sequence") and typeof(evt.get("sequence")) != TYPE_INT:
		errors.append("sequence must be integer")

	if props.has("type") and typeof(evt.get("type")) != TYPE_STRING:
		errors.append("type must be string")

	if props.has("payload") and typeof(evt.get("payload")) != TYPE_DICTIONARY:
		errors.append("payload must be object")

	if props.has("source_command_id") and typeof(evt.get("source_command_id")) != TYPE_STRING:
		errors.append("source_command_id must be string")

	if props.has("timestamp") and typeof(evt.get("timestamp")) != TYPE_INT:
		errors.append("timestamp must be integer")

	return errors.is_empty()
