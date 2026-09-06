// The district names and spelling supplied for this portal by BSDI.
const names = [
  'Awaran', 'Barkhan', 'Barshore', 'Chaghi', 'Chaman', 'Dera Bugti', 'Duki',
  'Gawadar', 'Harnai', 'Hub', 'Jaffarabad', 'Jhal Magsi', 'Kachhi', 'Kalat',
  'Kech', 'Kharan', 'Khuzdar', 'Killa Abdullah', 'Kohlu', 'Lasbela', 'Loralai',
  'Mastung', 'Musa Khel', 'Naseerabad', 'Nushki', 'Panjgur', 'Pishin',
  'Qilla Saifullah', 'Quetta', 'Sherani', 'Sibi', 'Sohbatpur', 'Surab', 'Tump',
  'Upper Dera Bugti', 'Usta Muhammad', 'Washuk', 'Zhob', 'Ziarat',
]

export const districts = Object.freeze(names.map((name) => Object.freeze({
  id: name.toLowerCase().replaceAll(' ', '-'), name, division: '',
})))
export const districtById = new Map(districts.map((district) => [district.id, district]))
