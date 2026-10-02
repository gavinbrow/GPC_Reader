/**
 * Enumerated identifiers used inside .afe8 files, reverse-engineered from
 * real ASTRA 8 experiments. Only codes whose meaning has been verified
 * against data are listed with confident names.
 */

/** m_nDataName codes of time-series data. */
export const DATA = {
  LS_DETECTORS: 12022, // matrix: time x LS detector voltages (V)
  AUX_CHANNELS: 12021, // matrix (LS): time x auxiliary analog inputs (V)
  LASER_MONITOR: 12018,
  FORWARD_MONITOR: 12305,
  LASER_CURRENT: 12303,
  LASER_VOLTAGE: 12395,
  LASER_TEMPERATURE: 12306,
  CELL_TEMPERATURE: 12307,
  DIFFERENTIAL_RI: 12025, // RIU
  ABSOLUTE_RI: 12489,
  RI_RAW: 12021, // RI instrument auxiliary voltage
  RI_TEMPERATURE: 12190,
  UV_CHANNELS: 12110, // matrix: time x UV channel absorbance (AU)
  SPECIFIC_VISCOSITY: 12112,
  HPLC_RIPPLE: 12581,
  HPLC_PRESSURE: 12583,
  HPLC_FLOW: 12585,
  EMPTY: 12485,
} as const;

export const UNIT_NAMES: Record<number, string> = {
  0: '',
  12059: '°C',
  12068: 'min',
  12069: 'g/mol',
  12070: 'nm',
  12072: 'V',
  12074: 'AU',
  12075: '',
  12098: '%',
  12114: 'AU·min',
  12304: 'A',
  12408: 'mL',
  12409: 'µg',
  12635: '',
};

/** Result codes in WResultData (per peak). */
export const RESULT_NAMES: Record<number, string> = {
  12120: 'Mn',
  12121: 'Mw',
  12122: 'Mz',
  12403: 'Mz+1',
  12343: 'Mp',
  12345: 'Mv',
  12126: 'M (avg)',
  12161: 'Mw/Mn',
  12162: 'Mz/Mn',
  12123: 'rn',
  12124: 'rw',
  12125: 'rz',
  12127: 'r (avg)',
  12479: 'rn (fit)',
  12480: 'rw (fit)',
  12503: 'rz (fit)',
  12285: 'Peak volume',
  2130: 'Calculated mass',
  2370: 'Mass recovery',
  2371: 'Mass fraction',
  12054: 'UV extinction coefficient (ch 1)',
  12566: 'UV extinction coefficient (ch 2)',
  12108: 'Laser monitor average',
  12342: 'Forward monitor average',
  12492: 'Laser current average',
  12493: 'Laser voltage average',
  2259: 'Peak area',
  2382: 'Peak height',
  2383: 'Peak retention time',
  2410: 'Peak centroid',
  2411: 'Peak sigma',
  2412: 'Peak skew',
  12558: 'Width at 50%',
  12559: 'Peak width (2)',
  2408: 'Peak width (3)',
  2424: 'Peak width (4)',
  12472: 'Theoretical plates',
  12473: 'Asymmetry',
  12560: 'Tailing factor',
  2381: 'Percent of peak',
};

export const INSTRUMENT_LABELS: Record<string, string> = {
  WHeleos8Profile: 'DAWN 8',
  WHeleosNeonProfile: 'DAWN',
  WHeleosProfile: 'DAWN HELEOS',
  WHeleosIIProfile: 'DAWN HELEOS II',
  WMiniDawnProfile: 'miniDAWN',
  WTreosProfile: 'miniDAWN TREOS',
  WDawnEosProfile: 'DAWN EOS',
  WNGOInstrumentProfile: 'Optilab',
  WOptilabRexProfile: 'Optilab rEX',
  WOptilabTrexProfile: 'Optilab T-rEX',
  WGenericRIInstrumentProfile: 'Generic RI',
  WHplcUVDeviceProfile: 'UV detector',
  WGenericUVInstrumentProfile: 'Generic UV',
  WGenericViscometerProfile: 'Generic Viscometer',
  WViscoStarProfile: 'ViscoStar',
  WHplcDeviceProfile: 'HPLC device',
  WHplcMultiDeviceProfile: 'HPLC system',
};

export const LS_MODELS = ['Zimm', 'Debye', 'Berry'] as const;
export const DESPIKE_LEVELS = ['Low', 'Normal', 'High'] as const;
