import countriesJson from '@/data/locations/countries.json'
import usStatesJson from '@/data/locations/us-states.json'
import caProvincesJson from '@/data/locations/ca-provinces.json'

export type CountryOption = { code: string; name: string }

export const COUNTRIES: CountryOption[] = countriesJson.items

export function countryDisplayName(code: string): string | undefined {
  return COUNTRIES.find((c) => c.code === code)?.name
}

/** Resolve stored country display name (from Firestore) back to ISO code for pickers. */
export function countryCodeForDisplayName(name: string | null | undefined): string {
  if (name == null) return ''
  const t = name.trim()
  if (!t) return ''
  return COUNTRIES.find((c) => c.name === t)?.code ?? ''
}

/** US states + DC; Canada provinces/territories — aligned with common iOS-style pickers. */
export function subdivisionsForCountryCode(code: string): string[] | null {
  if (code === 'US') return usStatesJson.items
  if (code === 'CA') return caProvincesJson.items
  return null
}
