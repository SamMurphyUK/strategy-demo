extends RefCounted
class_name GameSessionFactory

enum Mode { STUB, FULL }

const DEFAULT_MODE := Mode.STUB


static func create(mode: int = DEFAULT_MODE):
	match mode:
		Mode.STUB:
			var stub := GameSessionStub.new()
			stub.initialize_demo(12345)
			return stub
		Mode.FULL:
			if typeof(GameSceneSessionBuilder) != TYPE_NIL:
				return GameSceneSessionBuilder.create_session_from_newmap()
			push_error("GameSessionFactory: GameSceneSessionBuilder not available for FULL mode")
			return null
		_:
			push_error("GameSessionFactory: unknown mode %s" % mode)
			return null


static func load_json(path: String) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		push_error("GameSessionFactory: failed to open %s" % path)
		return {}
	var parsed: Variant = JSON.parse_string(file.get_as_text())
	file.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		push_error("GameSessionFactory: invalid JSON in %s" % path)
		return {}
	return parsed as Dictionary
