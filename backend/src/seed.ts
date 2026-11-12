import { OrgDirectory } from './stubs/orgDirectory.js';
import type { SessionService } from './stubs/sessionService.js';

/** Demo data standing in for the existing platform. */
export function seedOrgDirectory(): OrgDirectory {
  const orgs = new OrgDirectory();
  orgs.addOrg({ id: 'org_acme', name: 'Acme Construction' });
  orgs.addOrg({ id: 'org_globex', name: 'Globex Energy' });

  orgs.addContent({
    id: 'c_fire_safety',
    title: 'Fire Safety Basics',
    durationSeconds: 540,
    description: 'How fires start on site, how to raise the alarm, and how to get everyone out safely.',
    chapters: [
      { title: 'How fires start', startSeconds: 0 },
      { title: 'Raising the alarm', startSeconds: 150 },
      { title: 'Using an extinguisher', startSeconds: 300 },
      { title: 'Evacuation and assembly', startSeconds: 420 },
    ],
  });
  orgs.addContent({
    id: 'c_forklift',
    title: 'Forklift Hazard Awareness',
    durationSeconds: 720,
    description: 'Spotting forklift hazards and staying safe around moving vehicles in the yard and warehouse.',
    chapters: [
      { title: 'Blind spots', startSeconds: 0 },
      { title: 'Pedestrian zones', startSeconds: 240 },
      { title: 'Loads and stability', startSeconds: 480 },
    ],
  });
  orgs.addContent({
    id: 'c_confined_space',
    title: 'Confined Space Entry',
    durationSeconds: 900,
    description: 'Permits, gas testing and rescue planning before entering a confined space.',
    chapters: [
      { title: 'What counts as a confined space', startSeconds: 0 },
      { title: 'Permits and gas testing', startSeconds: 300 },
      { title: 'Rescue planning', startSeconds: 600 },
    ],
  });
  orgs.addContent({
    id: 'c_ladder',
    title: 'Working at Height: Ladders',
    durationSeconds: 480,
    description: 'Choosing, checking and using ladders safely.',
    chapters: [
      { title: 'Choosing the right ladder', startSeconds: 0 },
      { title: 'Pre-use checks', startSeconds: 160 },
      { title: 'Safe climbing', startSeconds: 320 },
    ],
  });

  orgs.enable({ orgId: 'org_acme', contentId: 'c_fire_safety', scope: { type: 'org' } });
  orgs.enable({ orgId: 'org_acme', contentId: 'c_forklift', scope: { type: 'org' } });
  orgs.enable({ orgId: 'org_acme', contentId: 'c_confined_space', scope: { type: 'groups', groupIds: ['g_supervisors'] } });
  orgs.enable({ orgId: 'org_globex', contentId: 'c_ladder', scope: { type: 'org' } });
  return orgs;
}

/** A couple of normal logged-in sessions, so the report shows both kinds side by side. */
export function seedSessions(sessions: SessionService): void {
  const done = sessions.create({ orgId: 'org_acme', contentId: 'c_fire_safety', actor: { type: 'user', userId: 'u_bob' } });
  sessions.close(done.id, 'completed');
  sessions.create({ orgId: 'org_acme', contentId: 'c_forklift', actor: { type: 'user', userId: 'u_bob' } });
}
