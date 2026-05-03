/**
 * Master list of SA shopping malls.
 * Coordinates are GPS centre-points used for Google Places Nearby Search.
 * storesUrl is the mall's own store directory page.
 * placeId is the Google Place ID (stable, preferred over text search).
 */

export interface MallSeed {
  name: string;
  city: string;
  province: string;
  lat: number;
  lng: number;
  /** Google Place ID — run findPlaceId() once to populate missing ones */
  placeId?: string;
  /** Mall's own store directory URL */
  storesUrl?: string;
  /** Search radius in metres for Google Nearby Search */
  radiusM?: number;
}

export const SA_MALLS: MallSeed[] = [
  // ── Gauteng ──────────────────────────────────────────────────────────────
  {
    name: "Sandton City",
    city: "Sandton",
    province: "Gauteng",
    lat: -26.1074,
    lng: 28.0564,
    placeId: "ChIJM1gOBRZilR4R5hGBNKNiPSA",
    storesUrl: "https://www.sandtoncity.com/stores",
  },
  {
    name: "Mall of Africa",
    city: "Midrand",
    province: "Gauteng",
    lat: -25.9968,
    lng: 28.1097,
    placeId: "ChIJ-c7X0KJilR4R8QNKXB_Kc4s",
    storesUrl: "https://www.mallofafrica.co.za/stores",
  },
  {
    name: "Menlyn Park Shopping Centre",
    city: "Pretoria",
    province: "Gauteng",
    lat: -25.7821,
    lng: 28.2762,
    placeId: "ChIJGTKEFcFelR4Rq5eQYMJQMQg",
    storesUrl: "https://www.menlyn.co.za/stores",
  },
  {
    name: "Eastgate Shopping Centre",
    city: "Bedfordview",
    province: "Gauteng",
    lat: -26.1824,
    lng: 28.1057,
    placeId: "ChIJWxdmkrFilR4RPdSSGJBP7_M",
    storesUrl: "https://www.eastgate.co.za/stores",
  },
  {
    name: "Rosebank Mall",
    city: "Rosebank",
    province: "Gauteng",
    lat: -26.1459,
    lng: 28.0424,
    placeId: "ChIJG37oY_FilR4Rq6LqXrFwHxA",
    storesUrl: "https://www.rosebankMall.co.za/stores",
  },
  {
    name: "Clearwater Mall",
    city: "Strubensvalley",
    province: "Gauteng",
    lat: -26.1064,
    lng: 27.9168,
    storesUrl: "https://www.clearwatermall.co.za/stores",
  },
  {
    name: "Fourways Mall",
    city: "Fourways",
    province: "Gauteng",
    lat: -26.0133,
    lng: 28.0114,
    storesUrl: "https://www.fourwaysmall.co.za/stores",
  },
  {
    name: "Hyde Park Corner",
    city: "Hyde Park",
    province: "Gauteng",
    lat: -26.1273,
    lng: 28.0338,
    storesUrl: "https://www.hydeparkcorner.co.za/stores",
  },
  {
    name: "The Glen Shopping Centre",
    city: "Glenvista",
    province: "Gauteng",
    lat: -26.2764,
    lng: 28.0462,
  },
  {
    name: "Cresta Shopping Centre",
    city: "Cresta",
    province: "Gauteng",
    lat: -26.1354,
    lng: 27.9724,
    storesUrl: "https://www.cresta.co.za/stores",
  },
  {
    name: "Woodlands Boulevard",
    city: "Pretoria",
    province: "Gauteng",
    lat: -25.8513,
    lng: 28.2201,
  },
  {
    name: "Brookfield Mall",
    city: "Pretoria",
    province: "Gauteng",
    lat: -25.7437,
    lng: 28.1889,
  },
  // ── Western Cape ─────────────────────────────────────────────────────────
  {
    name: "Canal Walk Shopping Centre",
    city: "Century City",
    province: "Western Cape",
    lat: -33.8943,
    lng: 18.5120,
    placeId: "ChIJX9f6rkxYzB0RpHJe0XHBQHI",
    storesUrl: "https://www.canalwalk.co.za/stores",
  },
  {
    name: "V&A Waterfront",
    city: "Cape Town",
    province: "Western Cape",
    lat: -33.9022,
    lng: 18.4197,
    placeId: "ChIJd0pGqFBYzB0RFiFBiToexXk",
    storesUrl: "https://www.waterfront.co.za/shops",
  },
  {
    name: "Cavendish Square",
    city: "Claremont",
    province: "Western Cape",
    lat: -33.9805,
    lng: 18.4655,
    storesUrl: "https://www.cavendish.co.za/stores",
  },
  {
    name: "Tyger Valley Shopping Centre",
    city: "Bellville",
    province: "Western Cape",
    lat: -33.8672,
    lng: 18.6285,
    storesUrl: "https://www.tygervalley.co.za/stores",
  },
  {
    name: "Somerset Mall",
    city: "Somerset West",
    province: "Western Cape",
    lat: -34.0762,
    lng: 18.8425,
    storesUrl: "https://www.somersetmall.co.za/stores",
  },
  {
    name: "N1 City Mall",
    city: "Goodwood",
    province: "Western Cape",
    lat: -33.9015,
    lng: 18.5376,
  },
  // ── KwaZulu-Natal ─────────────────────────────────────────────────────────
  {
    name: "Gateway Theatre of Shopping",
    city: "Umhlanga",
    province: "KwaZulu-Natal",
    lat: -29.7266,
    lng: 31.0777,
    placeId: "ChIJw3zp2s9LlR4RiJT6lrGVR8I",
    storesUrl: "https://www.gateway.co.za/stores",
  },
  {
    name: "La Lucia Mall",
    city: "La Lucia",
    province: "KwaZulu-Natal",
    lat: -29.7822,
    lng: 31.0623,
    storesUrl: "https://www.laluciamall.co.za/stores",
  },
  {
    name: "Pavilion Shopping Centre",
    city: "Westville",
    province: "KwaZulu-Natal",
    lat: -29.8369,
    lng: 30.9350,
    storesUrl: "https://www.thepavilion.co.za/stores",
  },
  {
    name: "Liberty Midlands Mall",
    city: "Pietermaritzburg",
    province: "KwaZulu-Natal",
    lat: -29.6167,
    lng: 30.4011,
    storesUrl: "https://www.libertymidlandsmall.co.za/stores",
  },
  {
    name: "Musgrave Centre",
    city: "Berea",
    province: "KwaZulu-Natal",
    lat: -29.8560,
    lng: 30.9986,
  },
  // ── Eastern Cape ─────────────────────────────────────────────────────────
  {
    name: "Greenacres Shopping Centre",
    city: "Port Elizabeth",
    province: "Eastern Cape",
    lat: -33.9403,
    lng: 25.5659,
    storesUrl: "https://www.greenacres.co.za/stores",
  },
  {
    name: "Baywest Mall",
    city: "Port Elizabeth",
    province: "Eastern Cape",
    lat: -33.9732,
    lng: 25.5213,
    storesUrl: "https://www.baywestmall.co.za/stores",
  },
  {
    name: "East London Quays",
    city: "East London",
    province: "Eastern Cape",
    lat: -32.9986,
    lng: 27.9082,
  },
  // ── Free State ────────────────────────────────────────────────────────────
  {
    name: "Mimosa Mall",
    city: "Bloemfontein",
    province: "Free State",
    lat: -29.1267,
    lng: 26.2191,
    storesUrl: "https://www.mimosamall.co.za/stores",
  },
  {
    name: "Brandwag Centre",
    city: "Bloemfontein",
    province: "Free State",
    lat: -29.1132,
    lng: 26.2028,
  },
  // ── Limpopo ───────────────────────────────────────────────────────────────
  {
    name: "Mall of the North",
    city: "Polokwane",
    province: "Limpopo",
    lat: -23.8956,
    lng: 29.4487,
    storesUrl: "https://www.mallofthenorth.co.za/stores",
  },
  {
    name: "Savannah Mall",
    city: "Polokwane",
    province: "Limpopo",
    lat: -23.8982,
    lng: 29.4684,
  },
  // ── Mpumalanga ────────────────────────────────────────────────────────────
  {
    name: "Emnotweni Arena",
    city: "Nelspruit",
    province: "Mpumalanga",
    lat: -25.4793,
    lng: 30.9729,
  },
  {
    name: "Crossing Shopping Centre",
    city: "Nelspruit",
    province: "Mpumalanga",
    lat: -25.4756,
    lng: 30.9831,
  },
  // ── North West ────────────────────────────────────────────────────────────
  {
    name: "Rustenburg Mall",
    city: "Rustenburg",
    province: "North West",
    lat: -25.6692,
    lng: 27.2401,
  },
  {
    name: "Mahikeng Mall",
    city: "Mahikeng",
    province: "North West",
    lat: -25.8553,
    lng: 25.6381,
  },
  // ── Northern Cape ─────────────────────────────────────────────────────────
  {
    name: "Kalahari Mall",
    city: "Upington",
    province: "Northern Cape",
    lat: -28.4617,
    lng: 21.2564,
  },
  {
    name: "Kimberley Mall",
    city: "Kimberley",
    province: "Northern Cape",
    lat: -28.7383,
    lng: 24.7699,
  },
];
