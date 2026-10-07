export type AdapterAvailability =
  | { status: "ready"; detail?: string }
  | { status: "disabled"; detail?: string }
  | { status: "unavailable"; detail: string };

export interface AdapterProbe {
  name: string;
  probe(): Promise<AdapterAvailability>;
}
