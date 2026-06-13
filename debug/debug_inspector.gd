extends CanvasLayer
class_name DebugInspector

var _session: Node = null
var drag_controller: Node = null
var map_root: Node = null


func configure(gs: Node, drag_ref: Node, map_ref: Node) -> void:
	_session = gs
	drag_controller = drag_ref
	map_root = map_ref


func _ready() -> void:
	set_process(false)


func _process(_delta: float) -> void:
	if not is_visible_in_tree():
		return

	var staged: Variant = []
	var adjacency: Dictionary = {}
	if _session:
		if _session.has_method("get_staged_units"):
			staged = _session.call("get_staged_units")
		elif _session.has_method("get_state"):
			var snapshot: Dictionary = _session.call("get_state")
			staged = snapshot.get("pending_purchases", {})
		if "state" in _session and _session.state != null and "adjacency" in _session.state:
			adjacency = _session.state.adjacency

	var payload: Dictionary = {}
	if drag_controller and "_drag_payload" in drag_controller:
		payload = drag_controller._drag_payload

	var label: Label = $DebugInspector/InspectorLabel
	label.text = (
		"[INSPECTOR]\n"
		+ "Staged Units: " + str(staged) + "\n"
		+ "Adjacency: " + str(adjacency) + "\n"
		+ "Drag Payload: " + str(payload) + "\n"
	)
