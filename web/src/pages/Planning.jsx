// Planning tab: flow-chart boards (admin and team leaders) and the month planner (admin and each team's head leader)
import { useState } from 'react';
import { useApp } from '../ui.jsx';
import Boards from './Boards.jsx';
import MonthPlanner from './MonthPlanner.jsx';

const VIEWS = [
  { id: 'boards', tab: 'Flow charts', title: 'Flow charts', blurb: 'Sketch the week: boxes, sticky notes, decisions and team members joined by lines. Shared with your team’s leaders; tick “Share with every team” on a board to show it to other teams’ leaders too.', admin: false },
  { id: 'month', tab: 'Month planner', title: 'Month planner', blurb: 'See who’s available all month, where spare people can go and whether every service has a Lead. Try placements as a draft, then apply them to the schedule.', admin: true },
];

export default function Planning() {
  const app = useApp();
  const isAdmin = !!app.me.head; // the admin, or this team's head leader
  const views = VIEWS.filter((v) => !v.admin || isAdmin);
  const [view, setView] = useState(isAdmin ? 'month' : 'boards');
  const v = views.find((x) => x.id === view) || views[0];
  return (
    <div className="stack-lg">
      <div className="page-head">
        <div>
          <h1>{v.title}</h1>
          <div className="muted">{v.blurb}</div>
        </div>
        {views.length > 1 && (
          <div className="seg" role="group" aria-label="View">
            {views.map((x) => (
              <button key={x.id} type="button" aria-pressed={v.id === x.id} onClick={() => setView(x.id)}>
                {x.tab}
              </button>
            ))}
          </div>
        )}
      </div>
      {v.id === 'boards' && <Boards />}
      {v.id === 'month' && <MonthPlanner />}
    </div>
  );
}
