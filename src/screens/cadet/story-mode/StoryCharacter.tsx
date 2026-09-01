import { STORY_ACTIONS } from './actions';
import { STORY_CHARACTER_LABELS } from './characters';
import type { StoryActionName, StoryCharacterId, StoryCharacterRole } from './types';

interface StoryCharacterProps {
  character: StoryCharacterId;
  role: StoryCharacterRole;
  action: StoryActionName;
  facing?: 'left' | 'right';
}

export function StoryCharacter({ character, role, action, facing = 'right' }: StoryCharacterProps) {
  return (
    <svg
      viewBox="0 0 120 220"
      className={`story-character story-character-${character} story-role-${role} story-facing-${facing} ${STORY_ACTIONS[action].cssClass}`}
      aria-label={`${STORY_CHARACTER_LABELS[character]}, ${role}`}
      role="img"
    >
      <g className="story-character-shadow" fill="rgba(0,0,0,0.22)">
        <ellipse cx="60" cy="210" rx="38" ry="7" />
      </g>
      <g className="story-character-body" fill="#071018">
        <circle cx="61" cy="40" r="21" />
        <path d="M43 59c5-8 30-8 36 0l10 72c2 17-8 28-28 28s-31-11-28-28z" />
        <path d="M47 55c-13 9-20 23-20 42 0 7 4 11 10 10 5-1 7-5 7-11 0-11 4-21 12-28z" className="story-arm story-arm-back" />
        <path d="M75 57c14 9 21 23 21 42 0 7-4 11-10 10-5-1-7-5-7-11 0-11-4-21-12-28z" className="story-arm story-arm-front" />
        <path d="M42 145c-3 17-6 35-7 54 0 8 4 12 10 12 6 0 9-4 10-11l8-47z" className="story-leg story-leg-back" />
        <path d="M66 148l8 51c1 8 5 12 11 11 6-1 9-5 8-12-2-19-5-37-9-54z" className="story-leg story-leg-front" />
        <path d="M43 28c4-15 33-17 39 1-8-5-14-6-20-3-7-4-13-3-19 2z" />
      </g>
      <path className="story-character-sash" d="M44 65c17 17 27 35 36 61" fill="none" strokeWidth="7" strokeLinecap="round" />
      <g className="story-carried-lamb">
        <ellipse cx="95" cy="91" rx="23" ry="15" fill="#d9d0b3" />
        <circle cx="113" cy="86" r="9" fill="#c8bea0" />
        <path d="M113 78l5-8 3 10zM108 79l-2-9-5 8z" fill="#9c8e70" />
        <path d="M82 103v16M96 104v16" stroke="#9c8e70" strokeWidth="5" strokeLinecap="round" />
      </g>
    </svg>
  );
}
