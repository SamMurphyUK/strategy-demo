import { loadJson } from "../content/res";
import { type Dict, isDict } from "../model/types";

export const SCHEMA_PATH = "res://docs/event_schema.json";

function isGdInt(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value);
}

export class EventSchemaValidator {
  private schema: Dict = {};
  errors: string[] = [];

  static validateEvent(evt: Dict, schema: Dict = {}): boolean {
    const v = new EventSchemaValidator();
    v.schema = Object.keys(schema).length === 0 ? v.loadSchema() : schema;
    return v.validate(evt);
  }

  static validateEvents(events: Dict[]): boolean {
    for (const evt of events) {
      if (!EventSchemaValidator.validateEvent(evt)) {
        return false;
      }
    }
    return true;
  }

  getErrors(): string[] {
    return this.errors;
  }

  private loadSchema(): Dict {
    return loadJson(SCHEMA_PATH);
  }

  private validate(evt: Dict): boolean {
    this.errors = [];
    if (Object.keys(this.schema).length === 0) {
      this.schema = this.loadSchema();
    }
    if (Object.keys(this.schema).length === 0) {
      this.errors.push("Schema not loaded");
      return false;
    }

    const required: string[] = this.schema.required ?? [];
    for (const key of required) {
      if (!(key in evt)) {
        this.errors.push(`Missing required field: ${key}`);
        return false;
      }
    }

    const props: Dict = this.schema.properties ?? {};

    if ("event_id" in props) {
      const eid = String(evt.event_id ?? "");
      const pattern = String(props.event_id.pattern ?? "");
      if (pattern !== "") {
        let regex: RegExp | null = null;
        try {
          regex = new RegExp(pattern);
        } catch {
          regex = null;
        }
        if (regex != null && !regex.test(eid)) {
          this.errors.push(`event_id does not match pattern: ${eid}`);
          return false;
        }
      }
    }

    if ("sequence" in props && !isGdInt(evt.sequence)) {
      this.errors.push("sequence must be integer");
    }
    if ("type" in props && typeof evt.type !== "string") {
      this.errors.push("type must be string");
    }
    if ("payload" in props && !isDict(evt.payload)) {
      this.errors.push("payload must be object");
    }
    if ("source_command_id" in props && typeof evt.source_command_id !== "string") {
      this.errors.push("source_command_id must be string");
    }
    if ("timestamp" in props && !isGdInt(evt.timestamp)) {
      this.errors.push("timestamp must be integer");
    }

    return this.errors.length === 0;
  }
}
