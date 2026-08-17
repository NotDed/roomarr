import { AppHeader } from '@/ui/AppHeader';
import { Inspector } from '@/ui/Inspector';
import { PlanStage } from '@/ui/PlanStage';
import '@/ui/styles.css';
import '@/render/plan.css';

export function App() {
  return (
    <div className="app">
      <AppHeader />
      <div className="app__body">
        <PlanStage />
        <Inspector />
      </div>
    </div>
  );
}
