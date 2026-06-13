extends CanvasLayer
class_name DebugInspector

var game_state: Variant = null
var drag_controller: Node = null
var map_root: Node = null


func configure(gs: Variant, drag_ref: Node, map_ref: Node) -> void:
	game_state = gs
	drag_controller = drag_ref
	map_root = map_ref


func _ready() -> void:
	set_process(false)


func _process(_delta: float) -> void:
	if not visible:
		return

	var staged: Array = []
	var adjacency: Dictionary = {}
	if game_state:
		if game_state.has_method("get_staged_units"):
			staged = game_state.get_staged_units()
		elif game_state.has_method("get_state"):
			var snapshot: Dictionary = game_state.get_state()
			staged = snapshot.get("pending_purchases", {})
		if "adjacency" in game_state:
			adjacency = game_state.adjacency
		elif "state" in game_state and game_state.state != null and "adjacency" in game_state.state:
			adjacency = game_state.state.adjacency

	var payload: Dictionary = {}
	if drag_controller and "_drag_payload" in drag_controller:
		payload = drag_controller._drag_payload

	var turn_info: Variant = {}
	var pending: Variant = {}
	if game_state and game_state.has_method("get_state"):
		var snapshot: Dictionary = game_state.get_state()
		turn_info = snapshot.get("turn_info", {})
		pending = snapshot.get("pending_purchases", {})

	var label: Label = $DebugInspector/InspectorLabel
	label.text = (
		"[INSPECTOR]\n"
		+ "Staged Units: " + str(staged) + "\n"
		+ "Adjacency: " + str(adjacency) + "\n"
		+ "Pending Purchases: " + str(pending) + "\n"
		+ "Turn Info: " + str(turn_info) + "\n"
		+ "Drag Payload: " + str(payload) + "\n"
	)
