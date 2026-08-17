import { AppHeader } from '@/ui/AppHeader';
import { EmptyState } from '@/ui/EmptyState';
import { Inspector } from '@/ui/Inspector';
import { Stage } from '@/ui/Stage';
import '@/ui/styles.css';

export function App() {
  return (
    <div className="app">
      <AppHeader />
      <div className="app__body">
        <Stage>
          <EmptyState />
        </Stage>
        <Inspector />
      </div>
    </div>
  );
}
