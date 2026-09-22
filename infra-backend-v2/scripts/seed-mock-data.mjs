import pool from '../src/config/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const uploadsRoot = path.join(__dirname, '..', 'uploads');

// Helper to write a small valid 1x1 PNG
const MOCK_PNG_BUFFER = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

// Helper to write a small minimal valid PDF
const MOCK_PDF_BUFFER = Buffer.from(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000009 00000 n\n0000000052 00000 n\n0000000101 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF\n',
  'utf-8'
);

const MOCK_TICKETS = [
  // ==========================================
  // 1. CIVIL - RECURRING MAINTENANCE (~10 tickets)
  // ==========================================
  {
    title: 'Ceiling plaster peeling and dampness in North Campus Hostel B3',
    department: 'Civil',
    type: 'recurring',
    description: 'Heavy moisture seepage during monsoons has caused plaster to crumble in room 204. Reinforcement mesh is visibly rusting. Urgent plastering and waterproofing required.',
    location: 'Hostel B3, 2nd Floor, Room 204 (Lat: 31.7812, Lng: 76.9942)',
    status: 'ASSIGNED_TO_JE',
    stage: 'assigned'
  },
  {
    title: 'Broken marble floor tiles and steps at Central Library Entrance',
    department: 'Civil',
    type: 'recurring',
    description: 'Multiple tiles near the main portico have cracked due to heavy foot traffic, posing a trip hazard for students. Replacement with non-skid Kota stone recommended.',
    location: 'Central Library, Main Portico Steps (Lat: 31.7820, Lng: 76.9950)',
    status: 'PENDING_AE_APPROVAL',
    stage: 'inspected',
    estimated_amount: 18500.00,
    nature_of_work: 'Replacement of 12 sqm cracked marble with heavy-duty Kota stone paving as per CPWD DSR Item 11.23.'
  },
  {
    title: 'Expansion joint leakage and water stagnation on Academic Block A Terrace',
    department: 'Civil',
    type: 'recurring',
    description: 'Bitumen sealant in structural expansion joint has degraded. Water drips into the server room directly below during continuous downpours.',
    location: 'Academic Block A, 4th Floor Roof (Lat: 31.7831, Lng: 76.9961)',
    status: 'PENDING_SE_APPROVAL',
    stage: 'se_review',
    estimated_amount: 42000.00,
    nature_of_work: 'Elastomeric polysulphide sealant application with backing rod along 35 meters expansion joint.'
  },
  {
    title: 'Structural concrete spalling on Faculty Residence Tower 2 Chajjas',
    department: 'Civil',
    type: 'recurring',
    description: 'Weathering has exposed rebar on window lintel chajjas on floors 3 and 4. Needs anti-corrosive primer and polymer-modified mortar repair.',
    location: 'Faculty Housing Tower 2, North Elevation (Lat: 31.7845, Lng: 76.9930)',
    status: 'PENDING_DEAN_APPROVAL',
    stage: 'dean_review',
    estimated_amount: 115000.00,
    nature_of_work: 'Surface preparation, zinc primer application on exposed steel, and structural micro-concrete repair.'
  },
  {
    title: 'Boundary wall subsidence and retaining wall crack near Riverfront Gate',
    department: 'Civil',
    type: 'recurring',
    description: 'A 40-meter stretch of the stone masonry retaining wall has developed 20mm shear cracks following hill slope runoff. Immediate reinforcement needed.',
    location: 'South Boundary, Near Gate 3 (Lat: 31.7790, Lng: 76.9915)',
    status: 'PENDING_DIRECTOR_APPROVAL',
    stage: 'director_review',
    estimated_amount: 385000.00,
    nature_of_work: 'Construction of RCC buttresses, weep-hole clearance, and plum concrete retaining foundation.'
  },
  {
    title: 'Sanitary plumbing stack pipe replacement in Dining Hall 1',
    department: 'Civil',
    type: 'recurring',
    description: 'Cast iron waste stack pipe has developed hairline cracks leading to foul odor and wastewater seepage in the dishwashing bay.',
    location: 'Mess Facility 1, Ground Floor Utility (Lat: 31.7805, Lng: 76.9948)',
    status: 'APPROVED_FOR_TENDERING',
    stage: 'sanctioned',
    estimated_amount: 32000.00,
    nature_of_work: 'Replacement of 60m CI pipes with CPVC Class 1 pipework and acoustic insulation.'
  },
  {
    title: 'Stormwater drainage desilting and RCC grating replacement near Workshop',
    department: 'Civil',
    type: 'recurring',
    description: 'Pre-monsoon silt accumulation has choked the peripheral open culvert. Broken cast iron gratings require replacement with heavy duty RCC covers.',
    location: 'Central Mechanical Workshop Peripheral Drain (Lat: 31.7850, Lng: 76.9975)',
    status: 'TENDER_PUBLISHED',
    stage: 'tendered',
    estimated_amount: 68000.00,
    nature_of_work: 'Hydraulic jet desilting of 250m culvert and installation of M30 precast perforated slab covers.'
  },
  {
    title: 'Waterproofing of Underground Drinking Water Reservoir No. 2',
    department: 'Civil',
    type: 'recurring',
    description: 'Periodic food-grade epoxy coating and negative-side crystalline waterproofing for 200kL drinking water tank.',
    location: 'Pumping Station Complex, North Hill (Lat: 31.7865, Lng: 76.9920)',
    status: 'WORK_IN_PROGRESS',
    stage: 'in_progress',
    estimated_amount: 145000.00,
    nature_of_work: 'Two-coat non-toxic potable certified epoxy coating with surface sandblasting.'
  },
  {
    title: 'Perimeter chain-link fence repair and anti-rust paint near Sports Ground',
    department: 'Civil',
    type: 'recurring',
    description: 'Storm damaged 3 panels of 2.4m GI chainlink fencing. Work executed, final measurement recorded.',
    location: 'Cricket Oval East Enclosure (Lat: 31.7785, Lng: 76.9960)',
    status: 'CLOSED',
    stage: 'closed',
    estimated_amount: 22000.00,
    nature_of_work: 'Welding of GI posts, replacement of 18m chainlink fabric, two coats of synthetic enamel paint.'
  },
  {
    title: 'False ceiling repair in Seminar Hall C',
    department: 'Civil',
    type: 'recurring',
    description: 'Suspended mineral fiber ceiling tiles sagging due to humidity. Initial estimate returned for inclusion of GI framework inspection.',
    location: 'School of Computing, Seminar Hall C (Lat: 31.7828, Lng: 76.9955)',
    status: 'RETURNED_TO_JE',
    stage: 'returned',
    estimated_amount: 38000.00,
    nature_of_work: 'Dismantling unstable gypsum framework and installing moisture-resistant acoustic grid panels.'
  },

  // ==========================================
  // 2. ELECTRICAL - RECURRING MAINTENANCE (~10 tickets)
  // ==========================================
  {
    title: 'Main Distribution Board overheating and tripping in BioX Complex',
    department: 'Electrical',
    type: 'recurring',
    description: 'Thermal imaging identified 78°C hotspot on Phase B busbar connection. 250A MCCB frequently trips under lab equipment load.',
    location: 'BioX Center, Ground Floor Electrical Room (Lat: 31.7838, Lng: 76.9968)',
    status: 'ASSIGNED_TO_JE',
    stage: 'assigned'
  },
  {
    title: 'Corridor emergency lighting battery backup failure in Girls Hostel 1',
    department: 'Electrical',
    type: 'recurring',
    description: '14 emergency self-contained LED luminaires fail to illuminate during DG switchover. Internal SMF batteries past useful life.',
    location: 'Girls Hostel 1, Wing A & B Corridors (Lat: 31.7818, Lng: 76.9935)',
    status: 'PENDING_AE_APPROVAL',
    stage: 'inspected',
    estimated_amount: 19800.00,
    nature_of_work: 'Replacement of 14 units 12V 7Ah sealed lead acid battery packs and testing of auto-switchover relays.'
  },
  {
    title: 'HVAC Chiller Plant condenser motor bearing failure in Data Center',
    department: 'Electrical',
    type: 'recurring',
    description: 'Unusual acoustic vibration and phase imbalance on Condenser Pump Motor 2. Rewinding and high-temperature SKF bearing fitment required.',
    location: 'Data Center Basement Utility Plant (Lat: 31.7825, Lng: 76.9945)',
    status: 'PENDING_SE_APPROVAL',
    stage: 'se_review',
    estimated_amount: 47500.00,
    nature_of_work: 'Complete rewinding of 15 HP induction motor, Class H insulation varnish, and dynamic balancing.'
  },
  {
    title: 'Substation 3 HT Vacuum Circuit Breaker (VCB) overhaul and relay calibration',
    department: 'Electrical',
    type: 'recurring',
    description: 'Mandatory statutory 3-year dielectric breakdown voltage (BDV) testing and numerical overcurrent relay calibration on 11kV bus.',
    location: 'Main Substation 3, South Substation (Lat: 31.7795, Lng: 76.9910)',
    status: 'PENDING_DEAN_APPROVAL',
    stage: 'dean_review',
    estimated_amount: 165000.00,
    nature_of_work: 'Transformer oil filtration, 11kV VCB contact resistance measurement, and primary injection testing of protection relays.'
  },
  {
    title: 'Replacement of damaged 185 sqmm 3.5C underground armored feeder cable',
    department: 'Electrical',
    type: 'recurring',
    description: 'Heavy earthmover work nicked the main power feeder cable supplying the Dining Hall 2. Temporary bypass running; permanent trenching required.',
    location: 'Main Spine Road, Between Mess 2 and Hostels (Lat: 31.7802, Lng: 76.9940)',
    status: 'PENDING_DIRECTOR_APPROVAL',
    stage: 'director_review',
    estimated_amount: 285000.00,
    nature_of_work: 'Excavation of 90m cable trench, laying of 185 sqmm XLPE aluminium cable, and heat shrink termination joints.'
  },
  {
    title: 'Surge Protection Device (SPD) burn-out at Advanced Computing Lab',
    department: 'Electrical',
    type: 'recurring',
    description: 'Recent lightning discharge damaged Type 1+2 surge arrester cartridge in Server Room incoming DB. Computers safe, but protection bypassed.',
    location: 'School of Computing, Room 314 Server Closet (Lat: 31.7830, Lng: 76.9952)',
    status: 'APPROVED_FOR_TENDERING',
    stage: 'sanctioned',
    estimated_amount: 24000.00,
    nature_of_work: 'Supply and installation of 40kA 4-Pole Modular SPD with remote status telemetry contact.'
  },
  {
    title: 'Solar Photovoltaic Inverter string replacement on Sports Complex Roof',
    department: 'Electrical',
    type: 'recurring',
    description: '50kW grid-tied rooftop solar inverter displaying IGBT bridge fault. Clerical GeM tender initiated for OEM replacement warranty module.',
    location: 'Indoor Sports Complex Rooftop (Lat: 31.7780, Lng: 76.9958)',
    status: 'TENDER_PUBLISHED',
    stage: 'tendered',
    estimated_amount: 88000.00,
    nature_of_work: 'Supply and integration of 50kW 3-Phase MPPT Grid-Tie Solar Inverter with SCADA monitoring interface.'
  },
  {
    title: 'Replacement of non-functional high-mast LED floodlights on Athletic Track',
    department: 'Electrical',
    type: 'recurring',
    description: '6 out of 16 floodlights on Mast #2 non-responsive. Contractor crane mobilized; work actively underway.',
    location: 'Athletic Track, High Mast Pole 2 (Lat: 31.7775, Lng: 76.9965)',
    status: 'WORK_IN_PROGRESS',
    stage: 'in_progress',
    estimated_amount: 72000.00,
    nature_of_work: 'Replacement of 6x 400W IP66 asymmetric optics LED floodlights and motorized winch servicing.'
  },
  {
    title: 'Earthing pit chemical reactivation and earth resistance audit at Substation 1',
    department: 'Electrical',
    type: 'recurring',
    description: 'Earth pit resistance measured 4.2 ohms (limit < 1.0 ohm). Chemical compound refilled, testing completed, final payment released.',
    location: 'Substation 1, North Campus (Lat: 31.7870, Lng: 76.9918)',
    status: 'CLOSED',
    stage: 'closed',
    estimated_amount: 21500.00,
    nature_of_work: 'Excavation, copper plate cleaning, marconite compound refilling, and certification to IS 3043.'
  },
  {
    title: 'Electric vehicle charging station circuit breaker tripped and terminal burnt',
    department: 'Electrical',
    type: 'recurring',
    description: 'Fast charger at Parking Lot 1 scorched terminal block. Returned to JE because warranty coverage with OEM had not been checked first.',
    location: 'Visitor Parking Lot 1 EV Station (Lat: 31.7810, Lng: 76.9930)',
    status: 'RETURNED_TO_JE',
    stage: 'returned',
    estimated_amount: 29000.00,
    nature_of_work: 'Inspection of 63A 4P isolator and verification of OEM warranty status before expenditure.'
  },

  // ==========================================
  // 3. HORTICULTURE - RECURRING MAINTENANCE (~10 tickets)
  // ==========================================
  {
    title: 'Termite infestation in pine trees along North Ridge Trail',
    department: 'Horticulture',
    type: 'recurring',
    description: '8 mature Pinus roxburghii showing significant trunk termite galleries and dead branches. Immediate anti-termite chemical drenching needed.',
    location: 'North Hill Ridge Trail, Chainage 0+450 (Lat: 31.7875, Lng: 76.9935)',
    status: 'ASSIGNED_TO_JE',
    stage: 'assigned'
  },
  {
    title: 'Overgrown wild grass and dry brush fire hazard near LPG Bullet Yard',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Post-monsoon wild foliage height exceeded 1.5 meters adjacent to central kitchen gas storage. Mandatory fire safety clearance required.',
    location: 'Central Kitchen LPG Cylinder Yard Perimeter (Lat: 31.7808, Lng: 76.9945)',
    status: 'PENDING_AE_APPROVAL',
    stage: 'inspected',
    estimated_amount: 14500.00,
    nature_of_work: 'Brush cutting, wild weed eradication across 2,400 sqm and disposal beyond fire safety buffer zone.'
  },
  {
    title: 'Automated pop-up drip irrigation pipeline rupture in Academic Quadrangle',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Underground HDPE lateral pipe punctured by landscape stakes. Lawn watering disrupted across 800 sqm botanical lawn.',
    location: 'Academic Quadrangle Main Lawn (Lat: 31.7822, Lng: 76.9958)',
    status: 'PENDING_SE_APPROVAL',
    stage: 'se_review',
    estimated_amount: 36000.00,
    nature_of_work: 'Excavation and replacement of 120m 32mm PN6 HDPE pipeline with solenoid control valve.'
  },
  {
    title: 'Slope bio-engineering and vetiver grass stabilization on landslide zone B',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Erosion gullies forming along cut slope below hostel access road. Coir geomatting and root-binding Chrysopogon zizanioides planting required.',
    location: 'Hostel Ring Road, Curve 4 Hill Cut (Lat: 31.7835, Lng: 76.9925)',
    status: 'PENDING_DEAN_APPROVAL',
    stage: 'dean_review',
    estimated_amount: 125000.00,
    nature_of_work: 'Supply and installation of 1,200 sqm coir geotextile with 6,000 vetiver grass slips on steep slope.'
  },
  {
    title: 'Felled tree removal and emergency root stabilization after flash storm',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Two large deodar trees uprooted blocking main campus roadway and partially resting on overhead telecom fiber cable lines.',
    location: 'Main Campus Spine Road, Near Gate 1 (Lat: 31.7800, Lng: 76.9920)',
    status: 'APPROVED_FOR_TENDERING',
    stage: 'sanctioned',
    estimated_amount: 44000.00,
    nature_of_work: 'Hydraulic crane log cutting, timber salvage auction preparation, and root ball extraction.'
  },
  {
    title: 'Seasonal floral bedding plantation and lawn turf renovation at Administrative Lawn',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Preparation of 16 seasonal flower beds (Petunia, Dianthus, Pansy) and mechanical aerification of 4,000 sqm turf.',
    location: 'Administrative Block Front Esplanade (Lat: 31.7815, Lng: 76.9932)',
    status: 'TENDER_PUBLISHED',
    stage: 'tendered',
    estimated_amount: 58000.00,
    nature_of_work: 'Supply of 8,000 nursery saplings, vermicompost topdressing, and hollow-tine lawn aeration.'
  },
  {
    title: 'Perimeter hedge pruning and tree canopy lifting on Primary Access Avenue',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Overhanging tree branches obstructing street lighting and surveillance camera field of view. Work in progress with boom lifter.',
    location: 'Institute Boulevard, 1.2km stretch (Lat: 31.7810, Lng: 76.9940)',
    status: 'WORK_IN_PROGRESS',
    stage: 'in_progress',
    estimated_amount: 32000.00,
    nature_of_work: 'Pruning of 180 avenue trees to 4.5m clearance and disposal of vegetative bio-waste to campus compost pits.'
  },
  {
    title: 'Installation of drip irrigation network for Herbal Medicinal Garden',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Executed installation of micro-sprinklers and timed drip manifolds for school of basic sciences research plants.',
    location: 'Botanical Garden Research Enclosure (Lat: 31.7840, Lng: 76.9970)',
    status: 'CLOSED',
    stage: 'closed',
    estimated_amount: 24500.00,
    nature_of_work: 'Commissioning of 400 micro-emitters, battery-operated timer valve, and sand filtration station.'
  },
  {
    title: 'Chemical spray treatment for aphid infestation in Rose Garden',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Severe aphid infestation damaging hybrid tea rose buds. Proposal returned by SE requesting bio-pesticide neem formulation instead of synthetic chemical.',
    location: 'Deanery Rose Garden (Lat: 31.7820, Lng: 76.9938)',
    status: 'RETURNED_TO_JE',
    stage: 'returned',
    estimated_amount: 16000.00,
    nature_of_work: 'Organic neem oil cold-pressed formulation foliar spray and soil application over 250 rose bushes.'
  },
  {
    title: 'Installation of decorative artificial turf on Open Air Amphitheatre steps',
    department: 'Horticulture',
    type: 'recurring',
    description: 'Applicant requested synthetic astroturf on amphitheatre stone risers. Rejected as per institute sustainability and natural landscape policy.',
    location: 'Student Activity Center Amphitheatre (Lat: 31.7800, Lng: 76.9950)',
    status: 'DENIED',
    stage: 'denied',
    estimated_amount: 65000.00,
    nature_of_work: 'Proposal for 40mm monofilament artificial grass installation.'
  },

  // ==========================================
  // 4. NON-RECURRING PROPOSALS / CAPEX PROJECTS (10 tickets)
  // ==========================================
  {
    title: 'Non-Recurring Proposal: Construction of Pre-engineered Covered Walkway between Hostels and Academic Block',
    department: 'Civil',
    type: 'non-recurring',
    description: 'Major CapEx project: 240-meter long covered pedestrian walkway with polycarbonate roofing and solar lighting to protect pedestrians from heavy snowfall and monsoons.',
    location: 'Central Spine Walkway, Connecting Hostels to Academic Block (Lat: 31.7825, Lng: 76.9940)',
    status: 'PENDING_DIRECTOR_APPROVAL',
    stage: 'director_review',
    estimated_amount: 1450000.00,
    nature_of_work: 'Fabrication of tubular steel portal frames, anti-UV multiwall polycarbonate sheeting, and tactile paving.'
  },
  {
    title: 'Non-Recurring Proposal: Setting up 250 kWp Rooftop Solar PV Microgrid with Lithium-ion BESS',
    department: 'Electrical',
    type: 'non-recurring',
    description: 'Strategic green campus proposal: Installation of bifacial mono-PERC solar arrays with 100 kWh battery energy storage system to cut peak diesel generator consumption.',
    location: 'Engineering Workshop and Lab Block Roofs (Lat: 31.7855, Lng: 76.9980)',
    status: 'PENDING_DIRECTOR_APPROVAL',
    stage: 'director_review',
    estimated_amount: 2850000.00,
    nature_of_work: 'Turnkey EPC installation of 250 kWp solar PV array, string inverters, and battery storage integration.'
  },
  {
    title: 'Non-Recurring Proposal: Construction of Hillside Terraced Ecological Herbal Garden and Hydroponic Glasshouse',
    department: 'Horticulture',
    type: 'non-recurring',
    description: 'State-of-the-art climate-controlled polyhouse facility for Himalayan endemic botanical research and student learning.',
    location: 'BioX Valley North Slope (Lat: 31.7880, Lng: 76.9950)',
    status: 'PENDING_DEAN_APPROVAL',
    stage: 'dean_review',
    estimated_amount: 180000.00,
    nature_of_work: 'Galvanized steel tubular polyhouse structure, automated misting system, and Dutch bucket hydroponics.'
  },
  {
    title: 'Non-Recurring Proposal: Establishment of Smart Electric Bus Charging Depot with HT Step-Down Substation',
    department: 'Electrical',
    type: 'non-recurring',
    description: 'Capital development for institutional transit: 4x 60kW DC dual-gun CCS2 fast chargers with dedicated 400 kVA 11/0.433 kV dry-type compact substation.',
    location: 'South Transit Bus Terminal (Lat: 31.7770, Lng: 76.9910)',
    status: 'APPROVED_FOR_TENDERING',
    stage: 'sanctioned',
    estimated_amount: 195000.00,
    nature_of_work: 'Civil transformer plinth, 400 kVA transformer, feeder pillars, and 4x dual-port DC fast chargers.'
  },
  {
    title: 'Non-Recurring Proposal: GeM Tender for Renovation and Acoustic Treatment of 500-Seater Auditorium',
    department: 'Civil',
    type: 'non-recurring',
    description: 'Complete interior renovation, motorized fire-retardant stage curtains, acoustic wall panelling, and push-back cushioned seating.',
    location: 'Main Auditorium Complex (Lat: 31.7818, Lng: 76.9965)',
    status: 'TENDER_PUBLISHED',
    stage: 'tendered',
    estimated_amount: 850000.00,
    nature_of_work: 'Perforated acoustic wooden panels, carpet tile flooring, and stage lighting trusses.'
  },
  {
    title: 'Non-Recurring Proposal: Installation of SCADA-Integrated Campus Water Leakage Monitoring and Smart Metering',
    department: 'Civil',
    type: 'non-recurring',
    description: 'Installation of ultrasonic flow meters at 24 distribution nodes with LoRaWAN wireless telemetry to monitor hydraulic pressure and detect subterranean leaks.',
    location: 'Campus-wide Distribution Network (Lat: 31.7820, Lng: 76.9940)',
    status: 'WORK_IN_PROGRESS',
    stage: 'in_progress',
    estimated_amount: 620000.00,
    nature_of_work: 'Supply and installation of 24 DN80/DN100 ultrasonic flowmeters, solar telemetry RTUs, and central IoT dashboard.'
  },
  {
    title: 'Non-Recurring Proposal: Turnkey Modernization of Fire Fighting Hydrant and Automatic Sprinkler System in Hostels',
    department: 'Civil',
    type: 'non-recurring',
    description: 'Executed complete overhaul of wet riser system, diesel jockey booster pumps, and addressable smoke detection in compliance with NBC Part 4.',
    location: 'Hostel Clusters 1, 2, and 3 (Lat: 31.7810, Lng: 76.9930)',
    status: 'CLOSED',
    stage: 'closed',
    estimated_amount: 480000.00,
    nature_of_work: 'Replacement of 450m MS Class C piping, 12 landing valves, and commissioning of 1800 LPM diesel fire pump.'
  },
  {
    title: 'Non-Recurring Proposal: Centralized Campus Air Quality Monitoring & Microclimate Weather Stations',
    department: 'Electrical',
    type: 'non-recurring',
    description: 'Deployment of 5 solar-powered ambient environmental telemetry towers measuring PM2.5, PM10, VOCs, humidity, and wind speed.',
    location: '5 Designated Academic and Residential Zones (Lat: 31.7830, Lng: 76.9950)',
    status: 'PENDING_SE_APPROVAL',
    stage: 'se_review',
    estimated_amount: 48000.00,
    nature_of_work: 'Fabrication of 6m mast towers, sensor enclosure boxes, and GSM telemetry modems.'
  },
  {
    title: 'Non-Recurring Proposal: Automated Mechanized Nursery and Soil Pasteurization Facility',
    department: 'Horticulture',
    type: 'non-recurring',
    description: 'Proposal to establish an institutional potting and seedling facility. Returned by SE for lack of detailed water availability study.',
    location: 'North Hill Horticulture Depot (Lat: 31.7885, Lng: 76.9960)',
    status: 'RETURNED_TO_JE',
    stage: 'returned',
    estimated_amount: 78000.00,
    nature_of_work: 'Construction of potting shed, steam soil sterilizer unit, and mechanical potting tray conveyor.'
  },
  {
    title: 'Non-Recurring Proposal: Private Helipad Construction on North Ridge',
    department: 'Civil',
    type: 'non-recurring',
    description: 'Applicant request for dedicated executive helicopter landing pad on ridge. Denied due to Forest Department environmental clearance restrictions.',
    location: 'North Ridge Viewpoint Peak (Lat: 31.7895, Lng: 76.9970)',
    status: 'DENIED',
    stage: 'denied',
    estimated_amount: 950000.00,
    nature_of_work: 'RCC circular landing pad, perimeter windsock, and aviation obstruction beacons.'
  }
];

export async function seedMockTickets() {
  console.log('================================================================');
  console.log('🌱 SEEDING COMPREHENSIVE MULTI-STAGE MOCK TICKETS & ATTACHMENTS');
  console.log('================================================================');

  const connection = await pool.getConnection();

  try {
    // 1. Fetch user mapping
    const [users] = await connection.query('SELECT id, name, role, department FROM users');
    
    const getUserId = (role, dept = null) => {
      let candidate = users.find(u => u.role === role && (!dept || u.department === dept));
      if (!candidate) candidate = users.find(u => u.role === role);
      return candidate ? candidate.id : 1;
    };

    const applicantId = getUserId('APPLICANT') || 1;
    const clericalId = getUserId('CLERICAL') || 1;
    const accountantId = getUserId('ACCOUNTANT') || 1;
    const aeCivilId = getUserId('AE', 'Civil');
    const aeElectId = getUserId('AE', 'Electrical');
    const aeHortId = getUserId('AE', 'Horticulture');
    const seId = getUserId('SE') || 1;
    const deanId = getUserId('DEAN') || 1;
    const directorId = getUserId('DIRECTOR') || 1;

    const jeMap = {
      Civil: getUserId('JE', 'Civil'),
      Electrical: getUserId('JE', 'Electrical'),
      Horticulture: getUserId('JE', 'Horticulture')
    };

    console.log(`👤 Using Actors: Applicant #${applicantId}, Clerical #${clericalId}, Accountant #${accountantId}`);

    let createdCount = 0;

    for (const item of MOCK_TICKETS) {
      const assignedJe = jeMap[item.department] || 1;
      const aeId = item.department === 'Electrical' ? aeElectId : item.department === 'Horticulture' ? aeHortId : aeCivilId;

      // 2. Insert Ticket
      const [ticketResult] = await connection.query(
        `INSERT INTO tickets (applicant_id, assigned_je_id, department, title, type, description, location, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW() - INTERVAL ? DAY)`,
        [
          applicantId,
          assignedJe,
          item.department,
          item.title,
          item.type,
          item.description,
          item.location,
          item.status,
          Math.floor(Math.random() * 20) + 1
        ]
      );

      const ticketId = ticketResult.insertId;
      createdCount++;

      // 3. Prepare Upload Folders on Disk
      const ticketUploadsDir = path.join(uploadsRoot, 'tickets', String(ticketId));
      const applicantEvidenceDir = path.join(ticketUploadsDir, 'applicant_evidence');
      const jeSitePhotosDir = path.join(ticketUploadsDir, 'je_reports', 'site_photos');
      const jeEstimateDocsDir = path.join(ticketUploadsDir, 'je_reports', 'estimate_docs');
      const tenderDocsDir = path.join(ticketUploadsDir, 'tenders');
      const billDocsDir = path.join(ticketUploadsDir, 'bills');

      fs.mkdirSync(applicantEvidenceDir, { recursive: true });
      fs.mkdirSync(jeSitePhotosDir, { recursive: true });
      fs.mkdirSync(jeEstimateDocsDir, { recursive: true });
      fs.mkdirSync(tenderDocsDir, { recursive: true });
      fs.mkdirSync(billDocsDir, { recursive: true });

      // Create applicant evidence file
      const applicantFileName = `evidence-${Date.now()}-${ticketId}.png`;
      fs.writeFileSync(path.join(applicantEvidenceDir, applicantFileName), MOCK_PNG_BUFFER);
      const applicantFileUrl = `/uploads/tickets/${ticketId}/applicant_evidence/${applicantFileName}`;

      await connection.query(
        `INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category, created_at)
         VALUES (?, ?, ?, 'APPLICANT_EVIDENCE', NOW() - INTERVAL 10 DAY)`,
        [ticketId, applicantFileUrl, applicantId]
      );

      // Audit log: Ticket Created
      await connection.query(
        `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
         VALUES (?, ?, 'CREATED', 'Ticket registered on Deanery of Infrastructure portal with geo-tagged photographic evidence.', NOW() - INTERVAL 10 DAY)`,
        [ticketId, applicantId]
      );

      // Audit log: Auto Assigned to JE
      await connection.query(
        `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
         VALUES (?, ?, 'ASSIGNED', 'Auto-assigned to ${item.department} Junior Engineer based on institutional jurisdictional division.', NOW() - INTERVAL 9 DAY)`,
        [ticketId, assignedJe]
      );

      // 4. If ticket progressed beyond initial assignment, create Report and JE attachments
      if (item.stage !== 'assigned') {
        const sitePhotoName = `site-inspection-${Date.now()}-${ticketId}.png`;
        const estimateDocName = `estimate-dsr-${Date.now()}-${ticketId}.pdf`;

        fs.writeFileSync(path.join(jeSitePhotosDir, sitePhotoName), MOCK_PNG_BUFFER);
        fs.writeFileSync(path.join(jeEstimateDocsDir, estimateDocName), MOCK_PDF_BUFFER);

        const sitePhotoUrl = `/uploads/tickets/${ticketId}/je_reports/site_photos/${sitePhotoName}`;
        const estimateDocUrl = `/uploads/tickets/${ticketId}/je_reports/estimate_docs/${estimateDocName}`;

        await connection.query(
          `INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category, created_at)
           VALUES (?, ?, ?, 'JE_SITE_PHOTO', NOW() - INTERVAL 8 DAY)`,
          [ticketId, sitePhotoUrl, assignedJe]
        );

        await connection.query(
          `INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category, created_at)
           VALUES (?, ?, ?, 'JE_ESTIMATE_DOC', NOW() - INTERVAL 8 DAY)`,
          [ticketId, estimateDocUrl, assignedJe]
        );

        await connection.query(
          `INSERT INTO reports (ticket_id, je_id, nature_of_work, estimated_amount, created_at)
           VALUES (?, ?, ?, ?, NOW() - INTERVAL 8 DAY)`,
          [ticketId, assignedJe, item.nature_of_work || 'CPWD technical inspection completed.', item.estimated_amount || 25000.00]
        );

        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'SUBMITTED', 'On-site technical inspection completed. DSR rate analysis and photographic logs uploaded. Estimated Amount: ₹${item.estimated_amount || 25000}.', NOW() - INTERVAL 8 DAY)`,
          [ticketId, assignedJe]
        );
      }

      // 5. Handling Stage Transitions & Audit Trails
      if (item.stage === 'se_review' || item.stage === 'dean_review' || item.stage === 'director_review' || item.stage === 'sanctioned' || item.stage === 'tendered' || item.stage === 'in_progress' || item.stage === 'closed') {
        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'PASSED', 'Technical estimate verified by Assistant Engineer (AE). Financial requirement exceeds ₹25,000 threshold, automatically forwarded to Superintending Engineer (SE).', NOW() - INTERVAL 7 DAY)`,
          [ticketId, aeId]
        );
      }

      if (item.stage === 'dean_review' || item.stage === 'director_review' || item.stage === 'sanctioned' || item.stage === 'tendered' || item.stage === 'in_progress' || item.stage === 'closed') {
        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'PASSED', 'Reviewed and endorsed by Superintending Engineer (SE). Escalated to Dean (Infrastructure) for sanction exceeding ₹50,000.', NOW() - INTERVAL 6 DAY)`,
          [ticketId, seId]
        );
      }

      if (item.stage === 'director_review' || (item.stage === 'sanctioned' && item.estimated_amount > 200000)) {
        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'PASSED', 'Executive appraisal completed by Dean (Infrastructure). Forwarded to Director for high-value CapEx sanction exceeding ₹2,00,000.', NOW() - INTERVAL 5 DAY)`,
          [ticketId, deanId]
        );
      }

      if (item.stage === 'sanctioned' || item.stage === 'tendered' || item.stage === 'in_progress' || item.stage === 'closed') {
        const approvingAuthority = item.estimated_amount > 200000 ? directorId : item.estimated_amount > 50000 ? deanId : seId;
        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'APPROVED', 'Administrative approval and financial expenditure sanction formally accorded. Ticket transmitted to Clerical Tender Desk for NIT publication.', NOW() - INTERVAL 5 DAY)`,
          [ticketId, approvingAuthority]
        );
      }

      // 6. Tender Details for Tendered, In-Progress, and Closed
      if (item.stage === 'tendered' || item.stage === 'in_progress' || item.stage === 'closed') {
        const nitNum = `NIT/IITM/INFRA/2026/${ticketId.toString().padStart(4, '0')}`;
        const portal = item.department === 'Electrical' ? 'CPP Portal' : 'GeM';
        const agency = item.department === 'Civil' ? 'M/s Himachal Infracon Pvt Ltd' : item.department === 'Electrical' ? 'M/s Shivalik Power Systems' : 'M/s Doon Valley Floritech';
        const tenderStatus = item.stage === 'tendered' ? 'PUBLISHED' : 'AWARDED';

        await connection.query(
          `INSERT INTO tenders (ticket_id, nit_number, portal_type, published_date, bid_opening_date, awarded_agency, work_order_value, status, remarks, created_by, created_at)
           VALUES (?, ?, ?, NOW() - INTERVAL 4 DAY, NOW() - INTERVAL 1 DAY, ?, ?, ?, 'Published under standard institutional e-procurement guidelines.', ?, NOW() - INTERVAL 4 DAY)`,
          [
            ticketId,
            nitNum,
            portal,
            item.stage === 'tendered' ? null : agency,
            item.stage === 'tendered' ? null : (item.estimated_amount * 0.96).toFixed(2),
            tenderStatus,
            clericalId
          ]
        );

        const tenderDocName = `nit-document-${ticketId}.pdf`;
        fs.writeFileSync(path.join(tenderDocsDir, tenderDocName), MOCK_PDF_BUFFER);
        const tenderDocUrl = `/uploads/tickets/${ticketId}/tenders/${tenderDocName}`;

        await connection.query(
          `INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category, created_at)
           VALUES (?, ?, ?, 'CLERK_TENDER_DOC', NOW() - INTERVAL 4 DAY)`,
          [ticketId, tenderDocUrl, clericalId]
        );

        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'APPROVED', 'Notice Inviting Tender (NIT) published on ${portal} under reference #${nitNum}.', NOW() - INTERVAL 4 DAY)`,
          [ticketId, clericalId]
        );

        if (item.stage !== 'tendered') {
          await connection.query(
            `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
             VALUES (?, ?, 'APPROVED', 'Competitive evaluation concluded. Contract awarded to ${agency} at agreed value ₹${(item.estimated_amount * 0.96).toFixed(2)}. Work Order dispatched.', NOW() - INTERVAL 3 DAY)`,
            [ticketId, clericalId]
          );
        }
      }

      // 7. Bills & PFMS Disbursements for In-Progress and Closed
      if (item.stage === 'in_progress' || item.stage === 'closed') {
        const isClosed = item.stage === 'closed';
        const billNum = isClosed ? `BILL-FINAL-${ticketId}` : `BILL-RA-01-${ticketId}`;
        const vchNum = isClosed ? `PFMS/VCH/2026/09/${ticketId}` : null;
        const gross = item.estimated_amount ? (item.estimated_amount * 0.95) : 35000;
        const deductions = (gross * 0.05).toFixed(2);
        const net = (gross - deductions).toFixed(2);
        const billType = isClosed ? 'FINAL_BILL' : 'RA_BILL';
        const paymentStatus = isClosed ? 'DISBURSED' : 'VERIFIED';

        await connection.query(
          `INSERT INTO bills (ticket_id, bill_number, voucher_number, agency_name, bill_type, gross_amount, deductions, net_amount, payment_status, payment_date, payment_mode, remarks, processed_by, created_at)
           VALUES (?, ?, ?, 'Authorized Contracting Vendor', ?, ?, ?, ?, ?, ?, 'PFMS', 'Verified against site measurement book (MB) and quality checks.', ?, NOW() - INTERVAL 2 DAY)`,
          [
            ticketId,
            billNum,
            vchNum,
            billType,
            gross.toFixed(2),
            deductions,
            net,
            paymentStatus,
            isClosed ? new Date() : null,
            accountantId
          ]
        );

        const billDocName = `sanction-bill-${ticketId}.pdf`;
        fs.writeFileSync(path.join(billDocsDir, billDocName), MOCK_PDF_BUFFER);
        const billDocUrl = `/uploads/tickets/${ticketId}/bills/${billDocName}`;

        await connection.query(
          `INSERT INTO attachments (ticket_id, file_url, uploaded_by, document_category, created_at)
           VALUES (?, ?, ?, 'FINANCE_SANCTION', NOW() - INTERVAL 2 DAY)`,
          [ticketId, billDocUrl, accountantId]
        );

        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'APPROVED', '${billType} #${billNum} of Net Amount ₹${net} committed to ledger by Accounts Desk.', NOW() - INTERVAL 2 DAY)`,
          [ticketId, accountantId]
        );

        if (isClosed) {
          await connection.query(
            `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
             VALUES (?, ?, 'APPROVED', 'PFMS Electronic Transfer executed under Voucher #${vchNum}. All contractual works inspected and certified complete. Ticket permanently CLOSED.', NOW() - INTERVAL 1 DAY)`,
            [ticketId, accountantId]
          );
        }
      }

      // 8. Handling Returned or Denied Tickets
      if (item.stage === 'returned') {
        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'RETURNED', 'Returned to Junior Engineer: Schedule of rates must conform strictly to DSR 2023 with local market price justification for specialized components.', NOW() - INTERVAL 3 DAY)`,
          [ticketId, aeId]
        );
      } else if (item.stage === 'denied') {
        await connection.query(
          `INSERT INTO audit_logs (ticket_id, user_id, action, remarks, created_at)
           VALUES (?, ?, 'DENIED', 'Proposal denied by Deanery Executive Committee: Does not conform to approved master campus plan and ecological conservation guidelines.', NOW() - INTERVAL 2 DAY)`,
          [ticketId, deanId]
        );
      }

      console.log(`  ✅ [#TKT-${ticketId.toString().padStart(4, '0')}] [${item.department.toUpperCase()} - ${item.type.toUpperCase()}] Stage: ${item.status}`);
    }

    console.log('================================================================');
    console.log(`🎉 SUCCESS: Generated ${createdCount} multi-stage tickets across all categories!`);
    console.log('================================================================');

  } catch (error) {
    console.error('💥 Error seeding mock data:', error);
  } finally {
    connection.release();
    process.exit(0);
  }
}

seedMockTickets();
