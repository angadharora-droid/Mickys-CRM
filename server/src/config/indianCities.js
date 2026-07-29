/**
 * Canonical Indian city names for the lead form's city dropdown, plus the
 * normalisation helpers that keep every stored city on a single spelling.
 *
 * The list covers every state and union territory: capitals, major cities and
 * the larger district centres. `canonicalCity()` maps free-text input onto it —
 * exact (case/punctuation-insensitive), then known aliases/old names, then a
 * conservative fuzzy match for typos — falling back to a tidied Title Case of
 * the input so non-Indian cities (export leads) pass through unharmed.
 */

const CITIES_BY_STATE = {
  'Andhra Pradesh': [
    'Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Kurnool', 'Rajahmundry', 'Tirupati',
    'Kakinada', 'Kadapa', 'Anantapur', 'Eluru', 'Ongole', 'Chittoor', 'Machilipatnam',
    'Srikakulam', 'Vizianagaram', 'Tenali', 'Proddatur', 'Hindupur', 'Amaravati',
  ],
  'Arunachal Pradesh': ['Itanagar', 'Naharlagun', 'Pasighat', 'Tawang', 'Ziro'],
  Assam: [
    'Guwahati', 'Silchar', 'Dibrugarh', 'Jorhat', 'Nagaon', 'Tinsukia', 'Tezpur', 'Bongaigaon',
    'Karimganj', 'Sivasagar', 'Goalpara', 'Barpeta', 'Dhubri', 'Diphu', 'Golaghat',
  ],
  Bihar: [
    'Patna', 'Gaya', 'Bhagalpur', 'Muzaffarpur', 'Purnia', 'Darbhanga', 'Bihar Sharif', 'Arrah',
    'Begusarai', 'Katihar', 'Munger', 'Chhapra', 'Danapur', 'Saharsa', 'Sasaram', 'Hajipur',
    'Dehri', 'Siwan', 'Motihari', 'Nawada', 'Bagaha', 'Buxar', 'Kishanganj', 'Sitamarhi',
    'Jamalpur', 'Jehanabad', 'Aurangabad (Bihar)',
  ],
  Chhattisgarh: [
    'Raipur', 'Bhilai', 'Bilaspur', 'Korba', 'Durg', 'Rajnandgaon', 'Jagdalpur', 'Raigarh',
    'Ambikapur', 'Mahasamund', 'Dhamtari', 'Chirmiri',
  ],
  Goa: ['Panaji', 'Margao', 'Vasco da Gama', 'Mapusa', 'Ponda'],
  Gujarat: [
    'Ahmedabad', 'Surat', 'Vadodara', 'Rajkot', 'Bhavnagar', 'Jamnagar', 'Junagadh', 'Gandhinagar',
    'Gandhidham', 'Anand', 'Navsari', 'Morbi', 'Nadiad', 'Surendranagar', 'Bharuch', 'Mehsana',
    'Bhuj', 'Porbandar', 'Palanpur', 'Valsad', 'Vapi', 'Godhra', 'Veraval', 'Botad', 'Amreli',
    'Deesa', 'Jetpur', 'Ankleshwar', 'Dahod', 'Himatnagar', 'Patan', 'Kalol', 'Halol', 'Bavla',
    'Radhanpur', 'Dwarka', 'Modasa', 'Visnagar', 'Unjha', 'Sidhpur', 'Kadi', 'Dholka', 'Sanand',
    'Gondal', 'Keshod', 'Mangrol', 'Upleta', 'Wadhwan', 'Limbdi', 'Dhrangadhra', 'Lunawada',
    'Chhota Udaipur', 'Vyara', 'Bardoli', 'Mundra', 'Khambhat', 'Petlad', 'Umreth', 'Borsad',
  ],
  Haryana: [
    'Faridabad', 'Gurugram', 'Panipat', 'Ambala', 'Yamunanagar', 'Rohtak', 'Hisar', 'Karnal',
    'Sonipat', 'Panchkula', 'Bhiwani', 'Sirsa', 'Bahadurgarh', 'Jind', 'Thanesar', 'Kaithal',
    'Rewari', 'Palwal', 'Kurukshetra', 'Fatehabad',
  ],
  'Himachal Pradesh': [
    'Shimla', 'Solan', 'Dharamshala', 'Mandi', 'Baddi', 'Nahan', 'Kullu', 'Hamirpur', 'Una',
    'Bilaspur (HP)', 'Chamba', 'Manali',
  ],
  Jharkhand: [
    'Ranchi', 'Jamshedpur', 'Dhanbad', 'Bokaro Steel City', 'Deoghar', 'Phusro', 'Hazaribagh',
    'Giridih', 'Ramgarh', 'Medininagar', 'Chirkunda', 'Dumka', 'Chaibasa',
  ],
  Karnataka: [
    'Bengaluru', 'Mysuru', 'Hubballi', 'Dharwad', 'Mangaluru', 'Belagavi', 'Kalaburagi',
    'Davanagere', 'Ballari', 'Vijayapura', 'Shivamogga', 'Tumakuru', 'Raichur', 'Bidar',
    'Hosapete', 'Hassan', 'Gadag', 'Udupi', 'Robertsonpet', 'Bhadravati', 'Chitradurga',
    'Kolar', 'Mandya', 'Chikkamagaluru', 'Gangavati', 'Bagalkote',
  ],
  Kerala: [
    'Thiruvananthapuram', 'Kochi', 'Kozhikode', 'Kollam', 'Thrissur', 'Alappuzha', 'Palakkad',
    'Kannur', 'Kottayam', 'Malappuram', 'Manjeri', 'Thalassery', 'Ponnani', 'Vatakara',
    'Kanhangad', 'Payyanur', 'Kasaragod', 'Kunnamkulam', 'Ottappalam', 'Thodupuzha',
    'Chalakudy', 'Changanassery', 'Punalur', 'Nilambur', 'Cherthala', 'Perinthalmanna',
    'Pathanamthitta', 'Idukki', 'Wayanad',
  ],
  'Madhya Pradesh': [
    'Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Sagar', 'Dewas', 'Satna', 'Ratlam',
    'Rewa', 'Murwara', 'Singrauli', 'Burhanpur', 'Khandwa', 'Bhind', 'Chhindwara', 'Guna',
    'Shivpuri', 'Vidisha', 'Chhatarpur', 'Damoh', 'Mandsaur', 'Khargone', 'Neemuch', 'Pithampur',
    'Hoshangabad', 'Itarsi', 'Sehore', 'Morena', 'Betul', 'Seoni', 'Datia', 'Nagda',
  ],
  Maharashtra: [
    'Mumbai', 'Pune', 'Nagpur', 'Thane', 'Nashik', 'Kalyan', 'Dombivli', 'Vasai', 'Virar',
    'Aurangabad', 'Navi Mumbai', 'Solapur', 'Mira-Bhayandar', 'Bhiwandi', 'Amravati', 'Nanded',
    'Kolhapur', 'Ulhasnagar', 'Sangli', 'Malegaon', 'Jalgaon', 'Akola', 'Latur', 'Dhule',
    'Ahmednagar', 'Chandrapur', 'Parbhani', 'Ichalkaranji', 'Jalna', 'Ambernath', 'Bhusawal',
    'Panvel', 'Badlapur', 'Beed', 'Gondia', 'Satara', 'Barshi', 'Yavatmal', 'Achalpur',
    'Osmanabad', 'Nandurbar', 'Wardha', 'Udgir', 'Hinganghat', 'Buldhana', 'Washim',
    'Ratnagiri', 'Baramati', 'Gadchiroli', 'Bhandara', 'Palghar', 'Shirdi', 'Lonavala',
    'Alibag', 'Chiplun', 'Karad', 'Pandharpur', 'Shrirampur', 'Parli', 'Amalner', 'Akot',
    'Kamptee', 'Umred', 'Wani', 'Butibori', 'Hingoli', 'Sindhudurg',
  ],
  Manipur: ['Imphal', 'Thoubal', 'Bishnupur', 'Churachandpur'],
  Meghalaya: ['Shillong', 'Tura', 'Jowai', 'Nongstoin'],
  Mizoram: ['Aizawl', 'Lunglei', 'Champhai'],
  Nagaland: ['Kohima', 'Dimapur', 'Mokokchung', 'Tuensang', 'Wokha'],
  Odisha: [
    'Bhubaneswar', 'Cuttack', 'Rourkela', 'Berhampur', 'Sambalpur', 'Puri', 'Balasore',
    'Bhadrak', 'Baripada', 'Jharsuguda', 'Jeypore', 'Angul', 'Dhenkanal', 'Barbil', 'Kendujhar',
    'Rayagada', 'Paradip', 'Bolangir', 'Koraput',
  ],
  Punjab: [
    'Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Hoshiarpur',
    'Batala', 'Pathankot', 'Moga', 'Abohar', 'Malerkotla', 'Khanna', 'Phagwara', 'Muktsar',
    'Barnala', 'Rajpura', 'Firozpur', 'Kapurthala', 'Sangrur', 'Fazilka', 'Gurdaspur',
    'Zirakpur', 'Faridkot', 'Mansa',
  ],
  Rajasthan: [
    'Jaipur', 'Jodhpur', 'Kota', 'Bikaner', 'Ajmer', 'Udaipur', 'Bhilwara', 'Alwar', 'Bharatpur',
    'Sikar', 'Pali', 'Sri Ganganagar', 'Kishangarh', 'Baran', 'Dhaulpur', 'Tonk', 'Beawar',
    'Hanumangarh', 'Gangapur City', 'Sawai Madhopur', 'Churu', 'Jhunjhunu', 'Barmer', 'Nagaur',
    'Chittorgarh', 'Banswara', 'Bundi', 'Sujangarh', 'Jaisalmer', 'Mount Abu', 'Dausa',
    'Pushkar', 'Sirohi',
  ],
  Sikkim: ['Gangtok', 'Namchi', 'Gyalshing', 'Mangan'],
  'Tamil Nadu': [
    'Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli', 'Salem', 'Tirunelveli', 'Tiruppur',
    'Vellore', 'Erode', 'Thoothukudi', 'Dindigul', 'Thanjavur', 'Ranipet', 'Sivakasi',
    'Karur', 'Udhagamandalam', 'Hosur', 'Nagercoil', 'Kancheepuram', 'Kumarapalayam',
    'Karaikkudi', 'Neyveli', 'Cuddalore', 'Kumbakonam', 'Tiruvannamalai', 'Pollachi',
    'Rajapalayam', 'Gudiyatham', 'Pudukkottai', 'Vaniyambadi', 'Ambur', 'Nagapattinam',
    'Viluppuram', 'Tindivanam', 'Mayiladuthurai', 'Krishnagiri', 'Theni', 'Namakkal',
    'Ramanathapuram', 'Perambalur', 'Ariyalur', 'Dharmapuri', 'Kanyakumari',
  ],
  Telangana: [
    'Hyderabad', 'Warangal', 'Nizamabad', 'Karimnagar', 'Ramagundam', 'Khammam', 'Mahbubnagar',
    'Nalgonda', 'Adilabad', 'Suryapet', 'Siddipet', 'Miryalaguda', 'Jagtial', 'Mancherial',
    'Secunderabad', 'Sangareddy', 'Medak',
  ],
  Tripura: ['Agartala', 'Udaipur (Tripura)', 'Dharmanagar', 'Kailashahar', 'Belonia'],
  'Uttar Pradesh': [
    'Lucknow', 'Kanpur', 'Ghaziabad', 'Agra', 'Varanasi', 'Meerut', 'Prayagraj', 'Bareilly',
    'Aligarh', 'Moradabad', 'Saharanpur', 'Gorakhpur', 'Noida', 'Greater Noida', 'Firozabad',
    'Jhansi', 'Muzaffarnagar', 'Mathura', 'Budaun', 'Rampur', 'Shahjahanpur', 'Farrukhabad',
    'Ayodhya', 'Maunath Bhanjan', 'Hapur', 'Etawah', 'Mirzapur', 'Bulandshahr', 'Sambhal',
    'Amroha', 'Hardoi', 'Fatehpur', 'Raebareli', 'Orai', 'Sitapur', 'Bahraich', 'Modinagar',
    'Unnao', 'Jaunpur', 'Lakhimpur', 'Hathras', 'Banda', 'Pilibhit', 'Barabanki', 'Khurja',
    'Gonda', 'Mainpuri', 'Lalitpur', 'Etah', 'Deoria', 'Ujhani', 'Ghazipur', 'Sultanpur',
    'Azamgarh', 'Bijnor', 'Sahaswan', 'Basti', 'Chandausi', 'Akbarpur', 'Ballia', 'Tanda',
    'Shikohabad', 'Shamli', 'Kasganj', 'Vrindavan',
  ],
  Uttarakhand: [
    'Dehradun', 'Haridwar', 'Roorkee', 'Haldwani', 'Rudrapur', 'Kashipur', 'Rishikesh',
    'Nainital', 'Mussoorie', 'Almora', 'Pithoragarh', 'Kotdwar', 'Ramnagar',
  ],
  'West Bengal': [
    'Kolkata', 'Howrah', 'Asansol', 'Siliguri', 'Durgapur', 'Bardhaman', 'Malda',
    'Baharampur', 'Habra', 'Kharagpur', 'Shantipur', 'Dankuni', 'Dhulian', 'Ranaghat',
    'Haldia', 'Raiganj', 'Krishnanagar', 'Nabadwip', 'Medinipur', 'Jalpaiguri', 'Balurghat',
    'Basirhat', 'Bankura', 'Chakdaha', 'Darjeeling', 'Alipurduar', 'Purulia', 'Jangipur',
    'Bangaon', 'Cooch Behar', 'Serampore', 'Barrackpore',
  ],
  'Andaman and Nicobar Islands': ['Port Blair'],
  Chandigarh: ['Chandigarh'],
  'Dadra and Nagar Haveli and Daman and Diu': ['Daman', 'Diu', 'Silvassa'],
  Delhi: ['New Delhi', 'Delhi'],
  'Jammu and Kashmir': [
    'Srinagar', 'Jammu', 'Anantnag', 'Baramulla', 'Sopore', 'Kathua', 'Udhampur',
  ],
  Ladakh: ['Leh', 'Kargil'],
  Lakshadweep: ['Kavaratti'],
  Puducherry: ['Puducherry', 'Karaikal', 'Mahe', 'Yanam'],
};

const INDIAN_CITIES = [...new Set(Object.values(CITIES_BY_STATE).flat())].sort((a, b) =>
  a.localeCompare(b)
);

// Old names, alternate spellings and frequent misspellings → canonical name.
// Keys are in normalised form (lowercase, letters only).
const ALIASES = {
  bombay: 'Mumbai', mumbay: 'Mumbai', mumbei: 'Mumbai',
  calcutta: 'Kolkata', calcuta: 'Kolkata',
  madras: 'Chennai',
  bangalore: 'Bengaluru', banglore: 'Bengaluru', bangaluru: 'Bengaluru',
  gurgaon: 'Gurugram', gurgoan: 'Gurugram',
  mysore: 'Mysuru',
  mangalore: 'Mangaluru',
  hubli: 'Hubballi',
  belgaum: 'Belagavi',
  gulbarga: 'Kalaburagi',
  bellary: 'Ballari',
  bijapur: 'Vijayapura',
  shimoga: 'Shivamogga',
  tumkur: 'Tumakuru',
  hospet: 'Hosapete',
  cochin: 'Kochi',
  calicut: 'Kozhikode',
  trivandrum: 'Thiruvananthapuram', trivendrum: 'Thiruvananthapuram',
  quilon: 'Kollam',
  alleppey: 'Alappuzha',
  cannanore: 'Kannur',
  trichur: 'Thrissur',
  palghat: 'Palakkad',
  allahabad: 'Prayagraj', alahabad: 'Prayagraj',
  benares: 'Varanasi', banaras: 'Varanasi', banarasi: 'Varanasi',
  faizabad: 'Ayodhya',
  mau: 'Maunath Bhanjan',
  trichy: 'Tiruchirappalli', tiruchirapalli: 'Tiruchirappalli', trichinopoly: 'Tiruchirappalli',
  tuticorin: 'Thoothukudi',
  ooty: 'Udhagamandalam', ootacamund: 'Udhagamandalam',
  tanjore: 'Thanjavur',
  kanchipuram: 'Kancheepuram',
  vizag: 'Visakhapatnam', visakapatnam: 'Visakhapatnam', vishakhapatnam: 'Visakhapatnam',
  vishakapatnam: 'Visakhapatnam', vizagapatam: 'Visakhapatnam',
  vijaywada: 'Vijayawada',
  cawnpore: 'Kanpur',
  pondicherry: 'Puducherry', pondy: 'Puducherry',
  baroda: 'Vadodara',
  poona: 'Pune', puna: 'Pune',
  tirupathi: 'Tirupati', thirupathi: 'Tirupati',
  nasik: 'Nashik',
  sholapur: 'Solapur',
  ahmedabaad: 'Ahmedabad', amdavad: 'Ahmedabad', ahmadabad: 'Ahmedabad',
  benaras: 'Varanasi',
  gauhati: 'Guwahati', gawahati: 'Guwahati',
  jamshedpur: 'Jamshedpur', tatanagar: 'Jamshedpur',
  waltair: 'Visakhapatnam',
  indore: 'Indore', indhore: 'Indore',
  nagpure: 'Nagpur', nagpour: 'Nagpur',
  dilli: 'Delhi', dehli: 'Delhi', newdehli: 'New Delhi',
  bhubaneshwar: 'Bhubaneswar',
  simla: 'Shimla',
  jullundur: 'Jalandhar',
  mohali: 'Mohali', sasnagar: 'Mohali',
  vasco: 'Vasco da Gama',
  bombivli: 'Dombivli', dombivali: 'Dombivli',
  kalyandombivli: 'Kalyan',
  aurangzebad: 'Aurangabad', sambhajinagar: 'Aurangabad', chhatrapatisambhajinagar: 'Aurangabad',
  osmanabad: 'Osmanabad', dharashiv: 'Osmanabad',
  himmatnagar: 'Himatnagar',
  ahemedabad: 'Ahmedabad', ahmedbad: 'Ahmedabad',
  chikmagalur: 'Chikkamagaluru', chikmagaluru: 'Chikkamagaluru', chikmangluru: 'Chikkamagaluru',
  // Well-known metro localities that arrive as the "city" on lead forms.
  chandkheda: 'Ahmedabad', sarkhej: 'Ahmedabad', maninagar: 'Ahmedabad', bopal: 'Ahmedabad',
  shertha: 'Gandhinagar',
  dwarkagujarat: 'Dwarka',
  gotri: 'Vadodara',
  // Not cities, but consistent display forms for what people type there:
  // state misspellings and country abbreviations seen on real leads.
  gujrat: 'Gujarat', gurat: 'Gujarat',
  usa: 'USA', uk: 'UK', uae: 'UAE', saudi: 'Saudi Arabia', saudiarabia: 'Saudi Arabia',
  // Common foreign cities on export leads — identity entries so the first-word
  // salvage can pick them out of values like "Dubai uae".
  dubai: 'Dubai', sharjah: 'Sharjah', abudhabi: 'Abu Dhabi', amman: 'Amman', muscat: 'Muscat',
  doha: 'Doha', riyadh: 'Riyadh', jeddah: 'Jeddah', london: 'London', singapore: 'Singapore',
  kathmandu: 'Kathmandu', colombo: 'Colombo', dhaka: 'Dhaka',
};

// States, regions and countries that show up in the city field. Never
// fuzzy-matched onto a city ("gujrat" must not become "Surat", "Usa" must not
// become "Una") — they pass through as tidied text unless an alias above gives
// them a canonical display form.
const NON_CITY = new Set([
  'india', 'bharat',
  'gujarat', 'maharashtra', 'rajasthan', 'punjab', 'haryana', 'bihar', 'jharkhand', 'odisha',
  'orissa', 'assam', 'kerala', 'karnataka', 'telangana', 'tamilnadu', 'westbengal',
  'uttarpradesh', 'madhyapradesh', 'andhrapradesh', 'himachalpradesh', 'uttarakhand',
  'chhattisgarh', 'chattisgarh', 'manipur', 'meghalaya', 'mizoram', 'nagaland', 'sikkim',
  'tripura', 'kashmir', 'jammukashmir',
  'saurashtra', 'kutch', 'kachchh', 'vidarbha', 'marathwada', 'malwa', 'konkan', 'bundelkhand',
  'oman', 'qatar', 'kuwait', 'bahrain', 'nepal', 'bangladesh', 'srilanka', 'pakistan', 'bhutan',
  'england', 'america', 'australia', 'canada', 'germany', 'france', 'russia', 'china', 'japan',
  'malaysia', 'indonesia', 'thailand', 'vietnam', 'egypt', 'kenya', 'nigeria', 'africa',
]);

// Non-Latin spellings (norm() strips these to nothing, so they are matched on
// the raw trimmed string instead). Keys must be lowercase.
const RAW_ALIASES = {
  'अहमदाबाद': 'Ahmedabad',
  'मुंबई': 'Mumbai',
  'दिल्ली': 'Delhi',
  'नई दिल्ली': 'New Delhi',
  'नागपुर': 'Nagpur',
  'सूरत': 'Surat',
  'पुणे': 'Pune',
  'जयपुर': 'Jaipur',
  'लखनऊ': 'Lucknow',
  'इंदौर': 'Indore',
  'भोपाल': 'Bhopal',
  'वडोदरा': 'Vadodara',
  'राजकोट': 'Rajkot',
};

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

const CANONICAL_BY_KEY = new Map(INDIAN_CITIES.map((c) => [norm(c), c]));

// Fuzzy matching searches alias spellings too ("Bangalor" is 1 edit from the
// alias "bangalore", far from the canonical "Bengaluru"). Built lazily since
// ALIASES is declared below.
let FUZZY_KEYS = null;
function fuzzyKeys() {
  if (!FUZZY_KEYS) {
    FUZZY_KEYS = new Map(CANONICAL_BY_KEY);
    for (const [key, value] of Object.entries(ALIASES)) {
      if (!FUZZY_KEYS.has(key)) FUZZY_KEYS.set(key, value);
    }
  }
  return FUZZY_KEYS;
}

/** Small Levenshtein distance with early exit beyond `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Collapse whitespace and Title Case each word (fallback for unknown cities). */
function titleCase(s) {
  return String(s || '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/** exact → alias → conservative fuzzy match for one normalised key, or null. */
function matchKey(key) {
  if (!key) return null;
  const exact = CANONICAL_BY_KEY.get(key);
  if (exact) return exact;
  const alias = ALIASES[key];
  if (alias) return alias;
  // States / regions / countries never snap to a city, however close a city
  // name happens to be.
  if (NON_CITY.has(key)) return null;

  // Fuzzy: allow 1 edit for short names, 2 for medium, 3 for long — but only
  // when there is a single best candidate, so ambiguous typos stay untouched.
  // Two keys resolving to the same city (an alias and its canonical) are one
  // candidate, not a tie.
  const max = key.length >= 9 ? 3 : key.length >= 5 ? 2 : 1;
  let best = null;
  let bestDist = max + 1;
  let tie = false;
  for (const [candKey, cand] of fuzzyKeys()) {
    const d = editDistance(key, candKey, max);
    if (d < bestDist) {
      best = cand;
      bestDist = d;
      tie = false;
    } else if (d === bestDist && cand !== best) {
      tie = true;
    }
  }
  return best && bestDist <= max && !tie ? best : null;
}

/**
 * Maps free-text input onto the canonical list: exact → alias → conservative
 * fuzzy (unique best match within a length-scaled typo budget). Messy values
 * get two safe salvage attempts — the portion before a comma ("Vadodara's,
 * call @ …"), then the first word by exact/alias only ("Chandkheda JD fast
 * food"). Unmatched input (e.g. a foreign city on an export lead) is returned
 * tidied, not rejected.
 */
function canonicalCity(input) {
  const tidy = String(input || '').replace(/\s+/g, ' ').trim();
  if (!tidy) return '';

  const raw = RAW_ALIASES[tidy.toLowerCase()];
  if (raw) return raw;

  const key = norm(tidy);
  if (!key) return titleCase(tidy);

  const full = matchKey(key);
  if (full) return full;

  const beforeComma = tidy.split(',')[0].trim();
  if (beforeComma && beforeComma !== tidy) {
    const partial = matchKey(norm(beforeComma));
    if (partial) return partial;
  }

  // First word: exact/alias only — fuzzy on a fragment would guess too much.
  const firstWord = norm(tidy.split(' ')[0]);
  if (firstWord.length >= 4 && firstWord !== key) {
    const word = CANONICAL_BY_KEY.get(firstWord) || ALIASES[firstWord];
    if (word) return word;
  }

  return titleCase(tidy);
}

const isKnownCity = (s) => CANONICAL_BY_KEY.has(norm(s));

module.exports = { CITIES_BY_STATE, INDIAN_CITIES, ALIASES, canonicalCity, isKnownCity, titleCase };
