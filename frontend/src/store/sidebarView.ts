import { atom } from 'jotai'

export type SidebarView = 'hosts' | 'sessions'
export const sidebarViewAtom = atom<SidebarView>('hosts')
