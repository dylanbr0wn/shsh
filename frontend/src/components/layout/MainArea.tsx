import { useAtomValue } from 'jotai'
import { sessionsAtom } from '../../store/atoms'
import { TabBar } from '../sessions/TabBar'
import { TerminalPane } from '../terminal/TerminalPane'
import { WelcomeScreen } from '../welcome/WelcomeScreen'

export function MainArea() {
  const sessions = useAtomValue(sessionsAtom)

  if (sessions.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 flex-col">
        <WelcomeScreen />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <TabBar />
      <div className="relative min-h-0 flex-1">
        <TerminalPane />
      </div>
    </div>
  )
}
