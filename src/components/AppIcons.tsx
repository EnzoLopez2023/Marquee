import type { ComponentType, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & {
  fontSize?: 'inherit' | 'small' | 'medium' | 'large' | string;
  sx?: unknown;
};

const glyphs: Record<string, string> = {
  AccessTime: '◷', Accordion: '⌄', ArrowBack: '←', ArrowDownward: '↓',
  ArrowForward: '→', AutoAwesome: '✦', AutoFixHigh: '✦', Block: '⊘',
  CalendarMonth: '□', CheckCircle: '●', CheckCircleOutline: '○',
  ChevronLeft: '‹', ChevronRight: '›', Close: '×', CloudDone: '☁',
  CloudDownload: '⇩', ContentCopy: '⧉', DeleteOutline: '⌫', Devices: '▣',
  Download: '⇩', Error: '!', ErrorOutline: '!', ExpandMore: '⌄',
  FiberManualRecord: '●', FilterAlt: '≡', FolderOff: '⊘', HelpOutline: '?',
  History: '↶', Info: 'i', Inventory2: '□', LayersOutlined: '▤',
  LibraryAddCheck: '✓', Movie: '▸', MoveToInbox: '⇩', MusicNote: '♪',
  NotificationsNone: '◌', OpenInNew: '↗', Person: '●', Photo: '▧',
  PlayArrow: '▶', PlaylistAdd: '+', PlaylistPlay: '▶', Refresh: '↻',
  ReportProblem: '!', Schedule: '◷', Search: '⌕', Security: '◆',
  Shuffle: '⇄', Sort: '↕', Star: '★', Storage: '▤', SystemUpdateAlt: '⇩',
  Tv: '▭', VideoLibrary: '▤', Warning: '!', WarningAmber: '!',
};

function icon(name: string): ComponentType<IconProps> {
  return function AppIcon({ fontSize = 'medium', style, ...props }: IconProps) {
    const size = fontSize === 'small' ? '1.1em' : fontSize === 'large' ? '1.8em' : '1.35em';
    return (
      <svg viewBox="0 0 24 24" role="img" aria-label={name} width={size} height={size}
        fill="currentColor" style={{ verticalAlign: 'middle', ...style }} {...props}>
        <text x="12" y="17" textAnchor="middle" fontSize="17" fontFamily="sans-serif">{glyphs[name] ?? '•'}</text>
      </svg>
    );
  };
}

export const AccessTime = icon('AccessTime');
export const ArrowBack = icon('ArrowBack');
export const ArrowDownward = icon('ArrowDownward');
export const ArrowForward = icon('ArrowForward');
export const AutoAwesome = icon('AutoAwesome');
export const AutoFixHigh = icon('AutoFixHigh');
export const Block = icon('Block');
export const CalendarMonth = icon('CalendarMonth');
export const CheckCircle = icon('CheckCircle');
export const CheckCircleOutline = icon('CheckCircleOutline');
export const ChevronLeft = icon('ChevronLeft');
export const ChevronRight = icon('ChevronRight');
export const Close = icon('Close');
export const CloudDone = icon('CloudDone');
export const CloudDownload = icon('CloudDownload');
export const ContentCopy = icon('ContentCopy');
export const DeleteOutline = icon('DeleteOutline');
export const Devices = icon('Devices');
export const Download = icon('Download');
export const Error = icon('Error');
export const ErrorOutline = icon('ErrorOutline');
export const ExpandMore = icon('ExpandMore');
export const FiberManualRecord = icon('FiberManualRecord');
export const FilterAlt = icon('FilterAlt');
export const FolderOff = icon('FolderOff');
export const HelpOutline = icon('HelpOutline');
export const History = icon('History');
export const Info = icon('Info');
export const Inventory2 = icon('Inventory2');
export const LayersOutlined = icon('LayersOutlined');
export const LibraryAddCheck = icon('LibraryAddCheck');
export const Movie = icon('Movie');
export const MoveToInbox = icon('MoveToInbox');
export const MusicNote = icon('MusicNote');
export const NotificationsNone = icon('NotificationsNone');
export const OpenInNew = icon('OpenInNew');
export const Person = icon('Person');
export const Photo = icon('Photo');
export const PlayArrow = icon('PlayArrow');
export const PlaylistAdd = icon('PlaylistAdd');
export const PlaylistPlay = icon('PlaylistPlay');
export const Refresh = icon('Refresh');
export const ReportProblem = icon('ReportProblem');
export const Schedule = icon('Schedule');
export const Search = icon('Search');
export const Security = icon('Security');
export const Shuffle = icon('Shuffle');
export const Sort = icon('Sort');
export const Star = icon('Star');
export const Storage = icon('Storage');
export const SystemUpdateAlt = icon('SystemUpdateAlt');
export const Tv = icon('Tv');
export const VideoLibrary = icon('VideoLibrary');
export const Warning = icon('Warning');
export const WarningAmber = icon('WarningAmber');
