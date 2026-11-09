import { expect, test } from "@playwright/test";
import positionReportSample from "../../data/samples/position-report.sample.json";
import { toAisVessel } from "../../app/ais-vessel";

const EXPECTED_VESSEL = {
  id: "275525000",
  name: "OPTIMUS",
  lat: 50.98557166666667,
  lon: 1.290155,
  speedKnots: 6.6,
  courseDeg: 228.3,
  timestamp: "2026-11-04T16:06:15.382Z",
  source: "aisstream",
};

test("converts the saved PositionReport sample to literal values", () => {
  expect(toAisVessel(positionReportSample)).toEqual(EXPECTED_VESSEL);
});

test("synthetic missing and whitespace ship names become null", () => {
  const missingName = structuredClone(positionReportSample);
  delete missingName.MetaData.ShipName;
  expect(toAisVessel(missingName)?.name).toBeNull();

  const whitespaceName = structuredClone(positionReportSample);
  whitespaceName.MetaData.ShipName = "   ";
  expect(toAisVessel(whitespaceName)?.name).toBeNull();
});

test("synthetic optional speed values preserve zero and reject invalid values", () => {
  for (const [speed, expected] of [[0, 0], [102.3, null], [-1, null]] as const) {
    const synthetic = structuredClone(positionReportSample);
    synthetic.Message.PositionReport.Sog = speed;
    expect(toAisVessel(synthetic)?.speedKnots).toBe(expected);
  }

  const missingSpeed = structuredClone(positionReportSample);
  delete missingSpeed.Message.PositionReport.Sog;
  expect(toAisVessel(missingSpeed)?.speedKnots).toBeNull();
});

test("synthetic course 360 becomes null", () => {
  const synthetic = structuredClone(positionReportSample);
  synthetic.Message.PositionReport.Cog = 360;
  expect(toAisVessel(synthetic)?.courseDeg).toBeNull();
});

test("synthetic invalid coordinates never create a vessel at zero", () => {
  for (const [lat, lon] of [[91, 181], [95, -200]] as const) {
    const synthetic = structuredClone(positionReportSample);
    synthetic.Message.PositionReport.Latitude = lat;
    synthetic.Message.PositionReport.Longitude = lon;
    expect(toAisVessel(synthetic)).toBeNull();
  }

  const stringCoordinate = structuredClone(positionReportSample);
  stringCoordinate.Message.PositionReport.Latitude = "50.9" as unknown as number;
  expect(toAisVessel(stringCoordinate)).toBeNull();
});

test("synthetic missing or empty MMSI and unparsable time are rejected", () => {
  const missingMmsi = structuredClone(positionReportSample);
  delete missingMmsi.MetaData.MMSI;
  expect(toAisVessel(missingMmsi)).toBeNull();

  const emptyMmsi = structuredClone(positionReportSample);
  emptyMmsi.MetaData.MMSI = "   " as unknown as number;
  expect(toAisVessel(emptyMmsi)).toBeNull();

  const invalidTime = structuredClone(positionReportSample);
  invalidTime.MetaData.time_utc = "not a timestamp";
  expect(toAisVessel(invalidTime)).toBeNull();
});
