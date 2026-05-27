extends GutTest

var stub: GameSessionStub


func before_each() -> void:
	stub = GameSessionStub.new()
	stub.initialize_demo(12345)


func test_purchase_reduces_ipc_and_emits_event() -> void:
	var initial_ipc: int = stub.get_state()["ipc"]["allies"]
	var cmd := {
		"command_id": "cmd1",
		"player_id": "allies",
		"type": "purchase_units",
		"payload": {"purchases": [{"unit_type_id": "infantry", "count": 1}]},
	}
	var res := stub.apply_command(cmd)
	assert_eq(res["result_type"], "ok")
	assert_gt(res["events"].size(), 0)
	assert_eq(res["events"][0]["type"], "unitspurchased")
	assert_true(GameSessionStub.validate_event_shape(res["events"][0]))
	assert_eq(stub.get_state()["ipc"]["allies"], initial_ipc - 3)
