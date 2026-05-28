extends GutTest

var demo_stub: GameSessionStub


func before_each() -> void:
	demo_stub = GameSessionStub.new()
	demo_stub.initialize_demo(12345)


func test_purchase_reduces_ipc_and_emits_event() -> void:
	var initial_ipc: int = demo_stub.get_state()["ipc"]["allies"]
	var cmd := {
		"command_id": "cmd1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	}
	var res := demo_stub.apply_command(cmd)
	assert_eq(res["result_type"], "ok")
	assert_gt(res["events"].size(), 0)
	assert_eq(res["events"][0]["type"], "unitspurchased")
	assert_true(GameSessionStub.validate_event_shape(res["events"][0]))
	assert_eq(demo_stub.get_state()["ipc"]["allies"], initial_ipc - 3)
