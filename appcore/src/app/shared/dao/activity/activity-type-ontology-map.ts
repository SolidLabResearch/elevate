import { ElevateSport } from "@elevate/shared/enums/elevate-sport.enum";

export const ACTIVO_NS = "https://w3id.org/activity-ontology#";
export const MEDTOP_NS = "http://cv.iptc.org/newscodes/mediatopic/";
export const OAACTIVITY_NS = "https://openactive.io/activity-list#";

const compactExactMatches: Record<ElevateSport, string[]> = {
  [ElevateSport.AlpineSki]: ["medtop:20001057", "oaactivity:f21b5af1-e230-47d4-a58a-858caee30691"],
  [ElevateSport.AmericanFootball]: ["medtop:20000823", "oaactivity:9caeb442-2834-4859-b660-9172ed61ee71"],
  [ElevateSport.Aquathlon]: ["oaactivity:9fee9fb7-9279-4b79-806e-0dc78782e308"],
  [ElevateSport.BackcountrySki]: [],
  [ElevateSport.Badminton]: ["medtop:20000847", "oaactivity:c0360db0-a817-4bae-9167-40f89b49fc9e"],
  [ElevateSport.Baseball]: ["medtop:20000849", "oaactivity:ab4a33f2-dc13-4f7f-afa4-a3184dc00eab"],
  [ElevateSport.Basketball]: ["medtop:20000851", "oaactivity:e09776e6-f1b4-421b-b667-5c5913cf97aa"],
  [ElevateSport.Boxing]: ["medtop:20000856", "oaactivity:d4417bb3-383f-489b-b0c7-731b82f3b220"],
  [ElevateSport.Canoeing]: ["medtop:20000877", "oaactivity:e0425262-6f1d-4c58-ba8a-dd790c5351b1"],
  [ElevateSport.Cardio]: [],
  [ElevateSport.Climbing]: ["oaactivity:d09970bc-e11c-40cc-a594-38e4ff32d611"],
  [ElevateSport.Combat]: [],
  [ElevateSport.Cricket]: ["medtop:20000888", "oaactivity:77e3f8fa-c8b3-4e4e-bf1a-ff4b914bb6ec"],
  [ElevateSport.Crossfit]: ["oaactivity:853eab30-5812-44a8-8996-9e9e107bc4f9"],
  [ElevateSport.Dance]: ["medtop:20000007", "oaactivity:6ca15167-51da-4d91-a1ae-8a45dc47b0ea"],
  [ElevateSport.Diving]: ["medtop:20000913", "oaactivity:aafbe00d-e03e-4e5d-9612-c53c8b332d94"],
  [ElevateSport.Drive]: [],
  [ElevateSport.Duathlon]: ["medtop:20000922", "oaactivity:7a0d4399-d7a2-43e4-b9dc-5bf88c7a7eea"],
  [ElevateSport.EBikeRide]: [],
  [ElevateSport.Elliptical]: ["oaactivity:831ce34c-0218-48f5-8de4-54332e983b01"],
  [ElevateSport.ESkateboard]: [],
  [ElevateSport.EUnicycle]: [],
  [ElevateSport.Fishing]: ["medtop:20000561", "oaactivity:72d19892-5f55-4e9c-87b0-a5433baa49c8"],
  [ElevateSport.Flying]: [],
  [ElevateSport.Football]: ["medtop:20001065", "oaactivity:0a5f732d-e806-4e51-ad40-0a7de0239c8c"],
  [ElevateSport.Frisbee]: ["medtop:20000938"],
  [ElevateSport.Golf]: ["medtop:20000940", "oaactivity:7ae6067a-07f7-4aea-9e1f-eeeea5ae9047"],
  [ElevateSport.Gymnastics]: ["medtop:20000942", "oaactivity:f6ccded0-2666-4a51-88a4-ed6905bb4313"],
  [ElevateSport.Handcycle]: [],
  [ElevateSport.Handball]: ["medtop:20000958", "oaactivity:14232d6d-5e9d-493d-b4a9-ce2061b79ba5"],
  [ElevateSport.HangGliding]: ["oaactivity:51ead1ae-5d80-41ba-931a-42df1a100cf2"],
  [ElevateSport.Hike]: ["oaactivity:619f374a-c1b6-48d2-aabe-a01b6dedb9fd"],
  [ElevateSport.HorsebackRiding]: ["medtop:20001241", "oaactivity:45a372d9-baca-4f6c-859f-04de3efae742"],
  [ElevateSport.IceHockey]: ["medtop:20000965", "oaactivity:d82e1366-afab-4c87-b94e-6b5372733b13"],
  [ElevateSport.IceSkate]: ["oaactivity:0b276929-8b33-4807-9f5e-687c8bb2c2f9"],
  [ElevateSport.InlineSkate]: ["oaactivity:7e5cb3ee-8c91-4f85-8c97-e335e0013eb3"],
  [ElevateSport.Kayaking]: ["medtop:20000979", "oaactivity:598ceb23-216c-4f8a-9a7a-0eef6e3a4ae8"],
  [ElevateSport.Kitesurf]: ["oaactivity:864619d9-0b10-4860-97cc-c31de79b2347"],
  [ElevateSport.Manual]: [],
  [ElevateSport.MotorSports]: ["oaactivity:41cab644-c5c3-4029-96fe-0ebe658c15c3"],
  [ElevateSport.Mountaineering]: ["medtop:20000886", "oaactivity:5fba2a76-07ee-4f99-b243-018245b0200d"],
  [ElevateSport.NordicSki]: ["medtop:20001060", "oaactivity:9bb258e2-57f2-423e-8dd8-a3796df1cfd1"],
  [ElevateSport.Orienteering]: ["medtop:20001011", "oaactivity:b2d5619e-56a7-4c40-b691-7f946f6ff5df"],
  [ElevateSport.Other]: [],
  [ElevateSport.Paragliding]: ["oaactivity:8395e45d-6bc4-4b76-8590-25839a63cc6c"],
  [ElevateSport.Ride]: ["medtop:20000892", "oaactivity:4a19873e-118e-43f4-b86e-05acba8fb1de"],
  [ElevateSport.RockClimbing]: ["oaactivity:ae0fdf39-41c2-492a-9a69-2853914d0413"],
  [ElevateSport.RollerSki]: ["oaactivity:36a18949-a10f-4161-9ac0-2fb7ae7f250f"],
  [ElevateSport.Rowing]: ["medtop:20001026", "oaactivity:d2733a1c-662c-427a-a270-400171c07320"],
  [ElevateSport.Rugby]: ["medtop:20001176", "oaactivity:5d528d2f-83df-482e-bfb9-fcaee5b85f4a"],
  [ElevateSport.Run]: ["oaactivity:72ddb2dc-7d75-424e-880a-d90eabe91381"],
  [ElevateSport.Sailing]: ["medtop:20001038", "oaactivity:6bb8b844-df3e-4cae-bf5f-3e129c6b1a9d"],
  [ElevateSport.Skateboard]: ["medtop:20001156", "oaactivity:50feff1b-790f-4f0f-9c07-0314557897c4"],
  [ElevateSport.SkiTouring]: [],
  [ElevateSport.SkyDiving]: ["medtop:20001062", "oaactivity:74d78e37-1a40-4856-8dcb-db356e1b8b4c"],
  [ElevateSport.Snorkeling]: ["oaactivity:84cfc236-7934-4668-9206-dbd753254a20"],
  [ElevateSport.Snowboard]: ["medtop:20001064", "oaactivity:7baa967e-87db-4346-84f8-5045ed49fd6a"],
  [ElevateSport.Snowmobiling]: [],
  [ElevateSport.Snowshoe]: [],
  [ElevateSport.Softball]: ["medtop:20001066", "oaactivity:ec1475e3-6ae4-4187-a492-8f821fbc2faa"],
  [ElevateSport.Squash]: ["medtop:20001068", "oaactivity:b7845b8a-4c0c-4a8f-93d3-d41d62eec889"],
  [ElevateSport.StairStepper]: ["oaactivity:23a62930-761a-4dd0-a54e-72e946904c43"],
  [ElevateSport.StandUpPaddling]: ["medtop:20001307", "oaactivity:12e7315a-3182-415b-aaf3-923d23adfdf8"],
  [ElevateSport.Stretching]: ["oaactivity:56be8d24-0c9b-438c-8679-192e5714daf9"],
  [ElevateSport.Surfing]: ["medtop:20001070", "oaactivity:ba5381a0-c981-4879-9b44-8b18e922c412"],
  [ElevateSport.Swim]: ["medtop:20001071", "oaactivity:2750229d-b725-4171-9276-376be913957c"],
  [ElevateSport.TableTennis]: ["medtop:20001083", "oaactivity:1a05993d-b206-4efe-85da-646fa340bdf4"],
  [ElevateSport.Tactical]: [],
  [ElevateSport.TelemarkSki]: ["medtop:20001153"],
  [ElevateSport.Tennis]: ["medtop:20001085", "oaactivity:f2ea7405-6098-4378-b0fe-4e398a659fc4"],
  [ElevateSport.TrackAndField]: ["medtop:20000827", "oaactivity:91dbf631-5071-43d2-b49d-3cecf2a40f5c"],
  [ElevateSport.Triathlon]: ["medtop:20001087", "oaactivity:c4e6c711-66fc-438e-b206-1dfdddc2d912"],
  [ElevateSport.Velomobile]: [],
  [ElevateSport.VirtualRide]: [],
  [ElevateSport.VirtualRun]: [],
  [ElevateSport.Volleyball]: ["medtop:20001089", "oaactivity:065c8564-144a-4833-b95a-db8550e6ac86"],
  [ElevateSport.Wakeboarding]: ["oaactivity:a11b2b1f-e0cd-4dd0-af89-498662f00cc1"],
  [ElevateSport.Walk]: ["oaactivity:95092977-5a20-4d6e-b312-8fddabe71544"],
  [ElevateSport.WaterSkiing]: ["medtop:20001092", "oaactivity:ba9a2508-fbc7-4cd2-bf5a-398211ba88a4"],
  [ElevateSport.WeightTraining]: ["oaactivity:25905e33-e0a3-466c-986e-aaed6bccdaef"],
  [ElevateSport.Wheelchair]: [],
  [ElevateSport.Windsurf]: ["medtop:20001097", "oaactivity:76282a7a-11cf-4da7-86f1-b0f192dd0f56"],
  [ElevateSport.Workout]: [],
  [ElevateSport.Yoga]: ["oaactivity:bf1a5e00-cdcf-465d-8c5a-6f57040b7f7e"]
};

export const exactMatchIrisByElevateSport: Record<ElevateSport, string[]> = Object.entries(compactExactMatches).reduce(
  (accumulator, [sport, mappings]) => ({
    ...accumulator,
    [sport]: mappings.map(expandCompactIri)
  }),
  {} as Record<ElevateSport, string[]>
);

export const elevateSportByActivityTypeIri: Record<string, ElevateSport> = Object.values(ElevateSport).reduce(
  (accumulator, sport) => {
    accumulator[activityTypeIriForElevateSport(sport)] = sport;
    exactMatchIrisByElevateSport[sport].forEach(iri => {
      accumulator[iri] = sport;
    });
    return accumulator;
  },
  {} as Record<string, ElevateSport>
);

export function activityTypeIriForElevateSport(sport: string | null | undefined): string {
  const mappedSport = Object.values(ElevateSport).includes(sport as ElevateSport)
    ? (sport as ElevateSport)
    : ElevateSport.Other;
  return `${ACTIVO_NS}${mappedSport}`;
}

export function elevateSportForActivityTypeIri(iri: string | null | undefined): ElevateSport | string | null {
  if (!iri) {
    return null;
  }

  const mappedSport = elevateSportByActivityTypeIri[iri];
  if (mappedSport) {
    return mappedSport;
  }

  if (iri.startsWith(ACTIVO_NS)) {
    return iri.slice(ACTIVO_NS.length);
  }

  return null;
}

function expandCompactIri(value: string): string {
  if (value.startsWith("medtop:")) {
    return `${MEDTOP_NS}${value.slice("medtop:".length)}`;
  }
  if (value.startsWith("oaactivity:")) {
    return `${OAACTIVITY_NS}${value.slice("oaactivity:".length)}`;
  }
  if (value.startsWith("activo:")) {
    return `${ACTIVO_NS}${value.slice("activo:".length)}`;
  }
  return value;
}
