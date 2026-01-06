export interface ProfileTemplate {
  id: string;
  name: string;
  description: string;
  values: number[];
}

export const profileTemplates: ProfileTemplate[] = [
  {
    id: 'evening_peak',
    name: 'Pointe soir',
    description: 'Pic de consommation 18h-21h',
    values: [15, 12, 10, 10, 10, 15, 25, 35, 40, 35, 30, 25, 25, 25, 25, 30, 40, 55, 70, 75, 65, 50, 35, 20],
  },
  {
    id: 'morning_peak',
    name: 'Pointe matin',
    description: 'Pic de consommation 7h-9h',
    values: [15, 12, 10, 10, 10, 20, 40, 65, 70, 55, 35, 30, 30, 30, 30, 35, 45, 55, 60, 55, 45, 35, 25, 18],
  },
  {
    id: 'workday',
    name: 'Jour ouvré',
    description: 'Actif 8h-18h',
    values: [5, 5, 5, 5, 5, 10, 20, 40, 70, 80, 85, 85, 75, 85, 85, 80, 70, 50, 30, 20, 15, 10, 8, 5],
  },
  {
    id: 'pv_summer',
    name: 'Production PV été',
    description: 'Courbe solaire estivale',
    values: [0, 0, 0, 0, 0, 5, 15, 35, 55, 70, 85, 95, 100, 95, 85, 70, 50, 30, 10, 2, 0, 0, 0, 0],
  },
  {
    id: 'pv_winter',
    name: 'Production PV hiver',
    description: 'Courbe solaire hivernale',
    values: [0, 0, 0, 0, 0, 0, 0, 5, 20, 40, 55, 65, 70, 65, 50, 30, 10, 0, 0, 0, 0, 0, 0, 0],
  },
  {
    id: 'ev_night',
    name: 'Recharge VE nuit',
    description: 'Recharge nocturne 22h-6h',
    values: [80, 80, 80, 80, 80, 80, 40, 10, 5, 5, 5, 5, 5, 5, 5, 5, 5, 10, 20, 30, 40, 50, 70, 80],
  },
  {
    id: 'ev_evening',
    name: 'Recharge VE soir',
    description: 'Recharge au retour 18h-22h',
    values: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 10, 20, 50, 80, 90, 85, 70, 40, 15],
  },
  {
    id: 'flat',
    name: 'Plat uniforme',
    description: '50% constant',
    values: Array(24).fill(50),
  },
  {
    id: 'industrial',
    name: 'Industriel standard',
    description: 'Usine 6h-22h',
    values: [10, 10, 10, 10, 10, 30, 70, 85, 90, 90, 90, 85, 80, 90, 90, 90, 85, 75, 60, 45, 30, 20, 15, 10],
  },
];
