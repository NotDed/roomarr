import { AppHeader } from '@/ui/AppHeader';
import { CompareStage } from '@/ui/CompareStage';
import { Inspector } from '@/ui/Inspector';
import { PlanStage } from '@/ui/PlanStage';
import { useStore } from '@/state/store';
import '@/ui/styles.css';
import '@/render/plan.css';

export function App() {
  const view = useStore((s) => s.view);

  /* The inspector stays put across both views. Compare is a different way of
     looking at the same document, not a different place — and the arrangements
     list is exactly what you want to hand while comparing them. */
  return (
    <div className="app">
      <AppHeader />
      <div className="app__body">
        {view === 'compare' ? <CompareStage /> : <PlanStage />}
        <Inspector />
      </div>
    </div>
  );
}
