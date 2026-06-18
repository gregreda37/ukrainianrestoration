// Drop a photo into src/assets/portfolio/<category-folder>/ and rebuild — it appears automatically.

export const CATEGORIES = [
  'All',
  'Kitchens',
  'Bathrooms',
  'Painting & Drywall',
  'Decks & Exterior',
  'Tiny Homes',
  'Water Damage',
]

const FOLDER_TO_CATEGORY = {
  'bathrooms':        'Bathrooms',
  'kitchens':         'Kitchens',
  'painting-drywall': 'Painting & Drywall',
  'decks-exterior':   'Decks & Exterior',
  'tiny-homes':       'Tiny Homes',
  'water-damage':     'Water Damage',
}

const modules = import.meta.glob(
  '../assets/portfolio/**/*.{jpg,jpeg,JPG,JPEG,png,PNG,gif}',
  { eager: true }
)

export const PHOTOS = Object.entries(modules).map(([path, mod]) => {
  const folder = path.split('/').at(-2)
  const category = FOLDER_TO_CATEGORY[folder] ?? folder
  return { src: mod.default, category, label: category }
})
