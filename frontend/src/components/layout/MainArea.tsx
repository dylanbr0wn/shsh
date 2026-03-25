import { useAtomValue } from 'jotai'
import { workspacesAtom } from '../../store/workspaces'
import { TabBar } from '../sessions/TabBar'
import { WorkspaceView } from '../terminal/WorkspaceView'
import { WelcomeScreen } from '../welcome/WelcomeScreen'

export function MainArea() {
  const workspaces = useAtomValue(workspacesAtom)

  if (workspaces.length === 0) {
    return (
      <div className="flex h-full min-w-0 flex-col">
        <WelcomeScreen />
      </div>
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <TabBar />
      <div className="relative min-h-0 flex-1">
        <WorkspaceView />
      </div>
    </div>
  )
}
