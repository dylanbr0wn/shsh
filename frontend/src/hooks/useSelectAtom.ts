import type { Atom } from 'jotai'
import { useAtomValue } from 'jotai'
import { selectAtom } from 'jotai/utils'

export function useSelectAtom(
  anAtom: Atom<unknown>,
  selector: (v: unknown, prevSlice?: unknown) => unknown
) {
  const selectorAtom = selectAtom(
    anAtom,
    selector
    // Alternatively, you can customize `equalityFn` to determine when it will rerender
    // Check selectAtom's signature for details.
  )
  return useAtomValue(selectorAtom)
}
