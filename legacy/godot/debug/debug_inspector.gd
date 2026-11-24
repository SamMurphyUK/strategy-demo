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

	# Must be Variant because session may return Array OR Dictionary
	var staged: Variant = []
	var adjacency: Variant = {}

	# -------------------------
	# STAGED UNITS
	# -------------------------
	if game_state:
		if game_state.has_method("get_staged_units"):
			staged = game_state.get_staged_units()
		elif game_state.has_method("get_state"):
			var snapshot: Dictionary = game_state.get_state()
			staged = snapshot.get("pending_purchases", {})

	# -------------------------
	# ADJACENCY
	# -------------------------
	if game_state:
		if "adjacency" in game_state:
			adjacency = game_state.adjacency
		elif "state" in game_state and game_state.state != null and "adjacency" in game_state.state:
			adjacency = game_state.state.adjacency

	# -------------------------
	# DRAG PAYLOAD
	# -------------------------
	var payload: Variant = {}
	if drag_controller and "_drag_payload" in drag_controller:
		payload = drag_controller._drag_payload

	# -------------------------
	# UPDATE LABEL
	# -------------------------
	var label: Label = $DebugInspector/InspectorLabel
	label.text = (
        "[INSPECTOR]\n"
		+ "Staged Units: " + str(staged) + "\n"
		+ "Adjacency: " + str(adjacency) + "\n"
		+ "Drag Payload: " + str(payload) + "\n"
	)
