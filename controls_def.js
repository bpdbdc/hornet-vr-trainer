// Cockpit controls. Positions come from the OpenHornet legend-plate holes (svg millimetres, origin top-left of the plate)
// or from reference-model positions (three.js metres, origin = design eye).
// dir: svg vector pointing to the label of states[0] (verified on the legend artwork).
// key: Sim.sw key written when the control changes. momentary: states that spring back to `rest`.

export const P = {
  APU: 'APU ENG CRANK', FUEL: 'FUEL PANEL', FCS: 'FCS PANEL', COMM: 'COMM PANEL', OBOGS: 'OBOGS', MC: 'MC HYD ISOL',
  ANT: 'ANT SEL', EXT: 'EXT LT', FIRE: 'FIRE TEST', SJ: 'SELECT JETT', LG: 'LANDING GEAR', UFC: 'UFC LEGEND', HUD: 'HUD PANEL',
  MA: 'MASTER ARM', SPIN: 'SPIN PANEL', IFEI: 'IFEI LEGEND', VID: 'HUD VIDEO', HC: 'HDG-CRS', RWRC: 'RWR CONTROL', DISP: 'DISP-EMC',
  ELEC: 'ELEC LEGEND', ECS: 'ECS LEGEND', DEFOG: 'DEFOG', INTR: 'INTR LT', SNSR: 'SNSR', KY: 'KY58 FWD', AVC: 'AV COOL', GT: 'GEN TIE',
};

const T2 = (id, name, panel, at, states, dir, key, extra = {}) => ({ id, name, panel, at, type: 'toggle', states, dir, key, ...extra });
const KN = (id, name, panel, at, key, extra = {}) => ({ id, name, panel, at, type: 'knob', key, ...extra });           // continuous 0..1
const RO = (id, name, panel, at, states, angles, key, extra = {}) => ({ id, name, panel, at, type: 'rotary', states, angles, key, ...extra });
const BT = (id, name, panel, at, extra = {}) => ({ id, name, panel, at, type: 'button', ...extra });

export const CONTROLS = [
  // ================= LEFT CONSOLE =================
  T2('apu', 'APU', P.APU, [76.2, 12.4], ['ON', 'OFF'], [1, 0], 'apu', { init: 'OFF' }),
  T2('crank', 'ENG CRANK', P.APU, [17.5, 23.6], ['L', 'OFF', 'R'], [0, -1], 'crank', { init: 'OFF', lock: true }),
  { id: 'apuReady', name: 'APU READY', panel: P.APU, at: [76.2, 38.9], type: 'light', light: 'READY', color: '#3dff6a', size: 11 },

  T2('extWing', 'EXT TANKS WING', P.FUEL, [61.4, 29.9], ['ORIDE', 'NORM', 'STOP'], [0, -1], 'extWing', { init: 'NORM' }),
  T2('extCtr', 'EXT TANKS CTR', P.FUEL, [94.5, 29.9], ['ORIDE', 'NORM', 'STOP'], [0, -1], 'extCtr', { init: 'NORM' }),
  T2('dump', 'FUEL DUMP', P.FUEL, [118.3, 46.8], ['ON', 'OFF'], [0, -1], 'dump', { init: 'OFF', lock: true }),
  T2('probe', 'PROBE', P.FUEL, [32.5, 46.8], ['EXTEND', 'RETRACT', 'EMERG EXTD'], [0, -1], 'probe', { init: 'RETRACT' }),

  T2('fcsGain', 'GAIN', P.FCS, [79, 22], ['ORIDE', 'NORM'], [0, -1], 'fcsGain', { init: 'NORM', guard: 'red' }),
  BT('fcsReset', 'FCS RESET', P.FCS, [119.9, 27.8], { size: 12, round: true, action: 'fcsReset' }),
  RO('rudTrim', 'RUD TRIM', P.FCS, [31.0, 32.2], ['L', 'C', 'R'], [-40, 0, 40], 'rudTrim', { init: 'C', knobSize: 20 }),
  BT('toTrim', 'T/O TRIM', P.FCS, [31.0, 32.2], { size: 8, round: true, action: 'toTrim', height: 0.012 }),

  T2('genTie', 'GEN TIE', P.GT, [40, 18], ['NORM', 'RESET'], [1, 0], 'genTie', { init: 'NORM', guard: 'red' }),

  T2('obogs', 'OBOGS', P.OBOGS, [14.4, 19.2], ['ON', 'OFF'], [-1, 0], 'obogs', { init: 'OFF' }),
  RO('oxyFlow', 'OXY FLOW', P.OBOGS, [61.4, 34.6], ['OFF', 'ON'], [0, 120], 'oxyFlow', { init: 'OFF', knobSize: 16 }),

  T2('mc', 'MC', P.MC, [28.0, 24.1], ['1 OFF', 'NORM', '2 OFF'], [0, -1], 'mc', { init: 'NORM' }),
  T2('hydIsol', 'HYD ISOL', P.MC, [88.3, 24.1], ['ORIDE', 'NORM'], [0, -1], 'hydIsol', { init: 'NORM' }),
  T2('antComm1', 'ANT SEL COMM 1', P.ANT, [28.6, 27.0], ['UPPER', 'AUTO', 'LOWER'], [0, -1], 'comm1Ant', { init: 'AUTO' }),
  T2('antIff', 'ANT SEL IFF', P.ANT, [60.6, 27.0], ['UPPER', 'BOTH', 'LOWER'], [0, -1], 'iffAnt', { init: 'BOTH' }),

  KN('formLt', 'FORMATION LT', P.EXT, [121.8, 37.3], 'formLt', { knobSize: 17 }),
  KN('posLt', 'POSITION LT', P.EXT, [81.8, 15.7], 'posLt', { knobSize: 17 }),
  T2('strobe', 'STROBE', P.EXT, [62.7, 42.7], ['BRT', 'OFF', 'DIM'], [1, 0], 'strobe', { init: 'OFF' }),
  T2('intWing', 'INTR WING', P.EXT, [21.4, 31.0], ['INHIBIT', 'NORM'], [1, 0], 'intWing', { init: 'NORM' }),

  T2('fireTest', 'FIRE & BLEED AIR TEST', P.FIRE, [36.9, 32.9], ['TEST A', 'NORM', 'TEST B'], 'fwd', 'fireTest', { init: 'NORM', momentary: ['TEST A', 'TEST B'], rest: 'NORM' }),

  // COMM panel (upper: IFF / ILS / crypto)
  T2('crypto', 'IFF CRYPTO', P.COMM, [25.4, 18.9], ['HOLD', 'NORM', 'ZERO'], [1, 0], 'crypto', { init: 'NORM' }),
  T2('mode4', 'IFF MODE 4', P.COMM, [25.4, 51.3], ['DIS/AUD', 'DIS', 'OFF'], [1, 0], 'mode4', { init: 'OFF' }),
  T2('iffMaster', 'IFF MASTER', P.COMM, [25.4, 83.7], ['EMERG', 'NORM'], [1, 0], 'iffMaster', { init: 'NORM', guard: 'red' }),
  RO('ilsChan', 'ILS CHANNEL', P.COMM, [68.8, 30.7], Array.from({ length: 20 }, (_, i) => String(i + 1)), Array.from({ length: 20 }, (_, i) => -150 + i * 15.8), 'ilsChan', { init: '1', knobSize: 20 }),
  T2('ilsMode', 'ILS UFC/MAN', P.COMM, [70.1, 83.7], ['UFC', 'MAN'], [1, 0], 'ilsMode', { init: 'UFC' }),
  T2('relay', 'KY-58 RELAY', P.COMM, [111.5, 20.1], ['CIPHER', 'OFF', 'PLAIN'], [1, 0], 'relay', { init: 'OFF' }),
  T2('gxmt', 'G XMT', P.COMM, [111.5, 50.0], ['COMM 1', 'OFF', 'COMM 2'], [1, 0], 'gxmt', { init: 'OFF' }),
  KN('volTcn', 'TCN VOL', P.COMM, [24.6, 121.4], 'volTcn', { init: 0.3 }),
  KN('volMidsB', 'MIDS B VOL', P.COMM, [56.4, 121.4], 'volMidsB', { init: 0.3 }),
  KN('volRwr', 'RWR VOL', P.COMM, [88.1, 121.4], 'volRwr', { init: 0.5 }),
  KN('volVox', 'VOX VOL', P.COMM, [119.9, 121.4], 'volVox', { init: 0.5 }),
  KN('volAux', 'AUX VOL', P.COMM, [24.6, 159.5], 'volAux', { init: 0.5 }),
  KN('volMidsA', 'MIDS A VOL', P.COMM, [56.4, 159.5], 'volMidsA', { init: 0.3 }),
  KN('volWpn', 'WPN VOL', P.COMM, [88.1, 159.5], 'volWpn', { init: 0.5 }),
  KN('volIcs', 'ICS VOL', P.COMM, [119.9, 159.5], 'volIcs', { init: 0.5 }),

  // ================= LEFT VERTICAL / SELECT JETT =================
  T2('launchBar', 'LAUNCH BAR', P.SJ, [122.6, 110.1], ['EXTEND', 'RETRACT'], [0, -1], 'launchBar', { init: 'RETRACT' }),
  T2('flaps', 'FLAPS', P.SJ, [86.0, 110.1], ['FULL', 'HALF', 'AUTO'], [0, -1], 'flaps', { init: 'AUTO' }),
  T2('antiSkid', 'ANTI SKID', P.SJ, [86.0, 71.2], ['OFF', 'ON'], [0, -1], 'antiSkid', { init: 'OFF' }),
  T2('ldgTaxi', 'LDG/TAXI LIGHT', P.SJ, [122.6, 62.8], ['OFF', 'ON'], [0, -1], 'ldgTaxi', { init: 'OFF' }),
  T2('hookBypass', 'HOOK BYPASS', P.SJ, [138.7, 18.6], ['CARRIER', 'FIELD'], [0, -1], 'hookBypass', { init: 'CARRIER' }),
  RO('selJett', 'SELECT JETT', P.SJ, [37.8, 97.9], ['L FUS MSL', 'SAFE', 'R FUS MSL', 'RACK/LCHR', 'STORES'], [-45, 0, 45, 90, 135], 'selJett', { init: 'SAFE', knobSize: 22 }),

  BT('warnSil', 'WARN TONE SIL', P.LG, [23.4, 55.5], { size: 9, round: true }),
  BT('downLock', 'DOWN LOCK ORIDE', P.LG, [60.6, 47.9], { size: 10, round: true }),

  // ================= MAIN INSTRUMENT PANEL =================
  T2('masterArm', 'MASTER ARM', P.MA, [23.1, 25.4], ['ARM', 'SAFE'], [1, 0], 'masterArm', { init: 'SAFE' }),
  BT('aaMode', 'A/A', P.MA, [56.8, 21.3], { size: 10, square: true, w: 11, h: 17 }),
  BT('agMode', 'A/G', P.MA, [44.8, 21.3], { size: 10, square: true, w: 11, h: 17 }),
  BT('fireExtL', 'FIRE EXTGH', P.MA, [69.7, 36.6], { size: 11, square: true }),

  T2('irCool', 'IR COOL', P.SPIN, [21.6, 26.7], ['ORIDE', 'NORM', 'OFF'], [-1, 0], 'irCool', { init: 'OFF' }),
  KN('hmd', 'HMD BRT', P.SPIN, [54.7, 21.3], 'hmd', { knobSize: 14 }),
  T2('spin', 'SPIN RECOVERY', P.SPIN, [106.5, 12.7], ['RCVY', 'NORM'], [0, -1], 'spin', { init: 'NORM', guard: 'yellow' }),

  // HUD control panel (svg +x = pilot left, +y = up)
  T2('hudRej', 'HUD REJ', P.HUD, [158.7, 45.7], ['NORM', 'REJ 1', 'REJ 2'], [0, 1], 'hudRej', { init: 'NORM' }),
  KN('hudSymBrt', 'HUD SYM BRT', P.HUD, [128.6, 45.7], 'hudSymBrt', { knobSize: 16 }),
  T2('hudSymMode', 'HUD DAY/NIGHT', P.HUD, [98.4, 45.7], ['DAY', 'NIGHT'], [0, 1], 'hudSymMode', { init: 'DAY' }),
  KN('hudBlkLvl', 'BLK LVL', P.HUD, [69.8, 45.7], 'hudBlkLvl', { knobSize: 14 }),
  T2('hudVideo', 'HUD VIDEO', P.HUD, [41.3, 45.7], ['W/B', 'VID', 'OFF'], [0, 1], 'hudVideo', { init: 'OFF' }),
  KN('hudBal', 'BAL', P.HUD, [11.1, 45.7], 'hudBal', { knobSize: 16, init: 0.5 }),
  KN('hudAoa', 'AOA INDEXER', P.HUD, [120.0, 16.2], 'hudAoa', { knobSize: 14, init: 0.5 }),
  T2('hudAlt', 'ALT', P.HUD, [92.1, 16.2], ['BARO', 'RDR'], [0, 1], 'hudAlt', { init: 'BARO' }),
  T2('hudAtt', 'ATT', P.HUD, [61.6, 16.2], ['INS', 'AUTO', 'STBY'], [0, 1], 'hudAtt', { init: 'INS' }),

  KN('ifeiBrt', 'IFEI BRT', P.VID, [150.8, 11.4], 'ifeiBrt', { knobSize: 10, init: 0.8 }),
  T2('vidSel', 'VIDEO SEL', P.VID, [111.1, 10.2], ['HUD', 'LDDI'], [1, 0], 'vidSel', { init: 'HUD' }),
  T2('vidRec', 'VIDEO RECORD', P.VID, [76.2, 10.2], ['MAN', 'OFF', 'AUTO'], [0, 1], 'vidRec', { init: 'OFF' }),

  T2('hdgSet', 'HDG SET', P.HC, [181.5, 23.4], ['L', 'C', 'R'], [1, 0], 'hdgSet', { init: 'C', momentary: ['L', 'R'], rest: 'C' }),
  T2('crsSet', 'CRS SET', P.HC, [13.8, 23.4], ['L', 'C', 'R'], [1, 0], 'crsSet', { init: 'C', momentary: ['L', 'R'], rest: 'C' }),

  // RWR control (button window, left -> right as seen by the pilot: POWER DISPLAY SPECIAL OFFSET BIT)
  BT('rwrPwr', 'ALR-67 POWER', P.RWRC, [108.1, 33.7], { size: 13, square: true, action: 'rwrPwr' }),
  BT('rwrDisp', 'RWR DISPLAY', P.RWRC, [90.3, 33.7], { size: 13, square: true }),
  BT('rwrSpec', 'RWR SPECIAL', P.RWRC, [72.5, 33.7], { size: 13, square: true }),
  BT('rwrOffset', 'RWR OFFSET', P.RWRC, [54.7, 33.7], { size: 13, square: true }),
  BT('rwrBit', 'RWR BIT', P.RWRC, [36.9, 33.7], { size: 13, square: true }),
  KN('rwrDmr', 'RWR DMR', P.RWRC, [18.9, 33.0], 'rwrDmr', { knobSize: 10 }),
  KN('rwrAudio', 'RWR AUDIO', P.RWRC, [18.9, 12.7], 'rwrAudio', { knobSize: 10 }),
  RO('rwrDis', 'DIS TYPE', P.RWRC, [109.3, 12.7], ['N', 'I', 'A', 'U', 'F'], [-60, -30, 0, 30, 60], 'rwrDis', { init: 'N', knobSize: 11 }),

  T2('auxRel', 'AUX REL', P.DISP, [22.7, 46.0], ['ENABLE', 'NORM'], [1, 0], 'auxRel', { init: 'NORM' }),
  T2('dispenser', 'DISPENSER', P.DISP, [84.3, 32.3], ['BYPASS', 'ON', 'OFF'], [1, 0], 'dispenser', { init: 'OFF' }),
  RO('ecm', 'ECM MODE', P.DISP, [103.9, 93.7], ['OFF', 'STBY', 'BIT', 'REC', 'XMIT'], [-70, -35, 0, 35, 70], 'ecm', { init: 'OFF', knobSize: 13 }),
  BT('ecmJett', 'ECM JETT', P.DISP, [146.6, 32.3], { size: 14, square: true }),

  // ================= RIGHT CONSOLE =================
  T2('genL', 'L GEN', P.ELEC, [27.8, 46.4], ['NORM', 'OFF'], [0, -1], 'genL', { init: 'NORM', lock: true }),
  T2('battery', 'BATTERY', P.ELEC, [72.2, 46.3], ['ON', 'OFF', 'ORIDE'], [0, -1], 'battery', { init: 'OFF', lock: true }),
  T2('genR', 'R GEN', P.ELEC, [116.7, 46.3], ['NORM', 'OFF'], [0, -1], 'genR', { init: 'NORM', lock: true }),

  RO('bleed', 'BLEED AIR', P.ECS, [40.5, 20.8], ['NORM', 'R OFF', 'OFF', 'L OFF'], [0, 90, 180, 270], 'bleed', { init: 'NORM', knobSize: 22, wrap: true, dirAxis: [0, 1] }),
  T2('engAntiIce', 'ENG ANTI ICE', P.ECS, [80.7, 20.2], ['ON', 'OFF', 'TEST'], [0, 1], 'engAntiIce', { init: 'OFF' }),
  T2('pitot', 'PITOT HEAT', P.ECS, [114.0, 20.2], ['ON', 'AUTO'], [0, 1], 'pitot', { init: 'AUTO' }),
  T2('cabinPress', 'CABIN PRESS', P.ECS, [32.2, 65.9], ['NORM', 'DUMP', 'RAM/DUMP'], [0, 1], 'cabinPress', { init: 'NORM' }),
  KN('cabinTemp', 'CABIN TEMP', P.ECS, [72.2, 67.5], 'cabinTemp', { knobSize: 20, init: 0.5 }),
  T2('ecsMode', 'ECS MODE', P.ECS, [114.3, 65.9], ['AUTO', 'MAN', 'OFF/RAM'], [0, 1], 'ecsMode', { init: 'AUTO' }),
  T2('windshield', 'WINDSHIELD', P.DEFOG, [16.5, 14.0], ['ANTI ICE', 'OFF', 'RAIN'], [1, 0], 'windshield', { init: 'OFF' }),

  KN('consoles', 'CONSOLES LT', P.INTR, [33.0, 20.8], 'consoles', { knobSize: 17 }),
  KN('instPnl', 'INST PNL LT', P.INTR, [71.6, 20.8], 'instPnl', { knobSize: 17 }),
  KN('flood', 'FLOOD LT', P.INTR, [110.2, 20.8], 'flood', { knobSize: 17 }),
  T2('ltTest', 'LT TEST', P.INTR, [20.0, 61.9], ['TEST', 'OFF'], [0, -1], 'ltTest', { init: 'OFF', momentary: ['TEST'], rest: 'OFF' }),
  KN('warnCaut', 'WARN/CAUT LT', P.INTR, [52.3, 61.9], 'warnCaut', { knobSize: 17, init: 0.5 }),
  KN('chart', 'CHART LT', P.INTR, [90.9, 61.9], 'chart', { knobSize: 17 }),
  T2('ltMode', 'LT MODE', P.INTR, [122.4, 61.9], ['NVG', 'NITE', 'DAY'], [0, -1], 'ltMode', { init: 'DAY' }),

  T2('flir', 'FLIR', P.SNSR, [31.0, 15.1], ['ON', 'STBY', 'OFF'], [0, -1], 'flir', { init: 'OFF' }),
  T2('ltdr', 'LTD/R', P.SNSR, [71.6, 17.7], ['ARM', 'SAFE'], [0, -1], 'ltdr', { init: 'SAFE' }),
  T2('lstNflr', 'LST/NFLR', P.SNSR, [112.0, 15.1], ['ON', 'OFF'], [0, -1], 'lstNflr', { init: 'OFF' }),
  RO('radar', 'RADAR', P.SNSR, [37.3, 53.2], ['OFF', 'STBY', 'OPR', 'EMERG'], [-90, -45, 0, 45], 'radar', { init: 'OFF', knobSize: 24 }),
  RO('ins', 'INS', P.SNSR, [112.0, 53.2], ['OFF', 'CV', 'GND', 'NAV', 'IFA', 'GYRO', 'GB', 'TEST'], [-90, -45, 0, 45, 90, 135, 180, 225], 'ins', { init: 'OFF', knobSize: 24 }),

  T2('avCool', 'FCS AV COOL', P.AVC, [67.3, 19.1], ['EMERG', 'NORM'], [0, -1], 'avCool', { init: 'NORM' }),

  RO('kyMode', 'KY-58 MODE', P.KY, [36.1, 25.7], ['P', 'C', 'LD', 'RV'], [-60, -20, 20, 60], 'kyMode', { init: 'C', knobSize: 20 }),
  RO('kyPower', 'KY-58 POWER', P.KY, [108.5, 62.2], ['OFF', 'ON', 'TD'], [60, 0, -60], 'ky58', { init: 'OFF', knobSize: 18 }),
  KN('kyVol', 'KY-58 VOLUME', P.KY, [36.1, 62.2], 'kyVol', { knobSize: 16 }),
];

// UFC (OpenHornet UFC legend plate, svg mm)
export const UFC_KEYS = [
  ['1', 35.1, 38.9], ['2', 53.9, 38.9], ['3', 72.7, 38.9],
  ['4', 35.1, 57.7], ['5', 53.9, 57.7], ['6', 72.7, 57.7],
  ['7', 35.1, 76.5], ['8', 53.9, 76.5], ['9', 72.7, 76.5],
  ['CLR', 35.1, 95.3], ['0', 53.9, 95.3], ['ENT', 72.7, 95.3],
  ['OSB1', 93.2, 16.5], ['OSB2', 93.2, 36.8], ['OSB3', 93.2, 57.2], ['OSB4', 93.2, 77.5], ['OSB5', 93.2, 97.8],
  ['I/P', 11.6, 22.9], ['EMCON', 160.2, 43.2],
  // function keys row (below the plate, between the COMM channel knobs)
  ['A/P', 36, 123], ['IFF', 53, 123], ['TCN', 70, 123], ['ILS', 87, 123], ['D/L', 104, 123], ['BCN', 121, 123], ['ON/OFF', 138, 123],
];
export const UFC_APERTURES = {     // svg mm rectangles (cx, cy, w, h)
  scratch: [52.5, 16.8, 55, 10], options: [126.0, 57.3, 46, 109], comm1: [12.9, 97.9, 15, 21], comm2: [160.1, 97.9, 15, 21],
};
export const UFC_KNOBS = [
  KN('comm1Vol', 'COMM 1 VOL', P.UFC, [12.2, 68.3], 'comm1Vol', { knobSize: 12, init: 0.5 }),
  KN('comm2Vol', 'COMM 2 VOL', P.UFC, [159.5, 68.3], 'comm2Vol', { knobSize: 12, init: 0.5 }),
  KN('ufcBrt', 'UFC BRT', P.UFC, [159.5, 23.2], 'ufcBrt', { knobSize: 12, init: 0.7 }),
  T2('adf', 'ADF', P.UFC, [11.3, 43.2], ['1', 'OFF', '2'], [0, -1], 'adf', { init: 'OFF' }),
  { id: 'comm1Ch', name: 'COMM 1 CHANNEL', panel: P.UFC, at: [12.9, 123], type: 'channel', radio: 1, knobSize: 15 },
  { id: 'comm2Ch', name: 'COMM 2 CHANNEL', panel: P.UFC, at: [160.1, 123], type: 'channel', radio: 2, knobSize: 15 },
];

// IFEI (svg mm on the IFEI plate); buttons are on the bezel just above the plate
export const IFEI_WINDOWS = { eng: [44.5, 60.3, 65, 88], labels: [92.7, 58.8, 21, 101], fuel: [130.8, 41.8, 45, 51], time: [130.8, 88.9, 45, 31] };
export const IFEI_BUTTONS = [['MODE', 20, -6], ['QTY', 40, -6], ['UP', 60, -6], ['DOWN', 80, -6], ['ZONE', 100, -6], ['ET', 120, -6]];
