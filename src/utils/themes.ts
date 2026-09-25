import { Theme } from '../components/ui/AppProperties';

export interface ThemeProps {
  cssVariables: any;
  id: Theme;
  name: string;
  splashImage: string;
}

export const THEMES: Array<ThemeProps> = [
  {
    id: Theme.Dark,
    name: 'settings.themes.dark',
    splashImage: '/splash-dark.jpg',
    cssVariables: {
      '--app-bg-primary': 'rgb(24, 24, 24)',
      '--app-bg-secondary': 'rgb(35, 35, 35)',
      '--app-surface': 'rgb(28, 28, 28)',
      '--app-card-active': 'rgb(43, 43, 43)',
      '--app-button-text': 'rgb(0, 0, 0)',
      '--app-text-primary': 'rgb(232, 234, 237)',
      '--app-text-secondary': 'rgb(158, 158, 158)',
      '--app-accent': 'rgb(255, 255, 255)',
      '--app-border-color': 'rgb(45, 45, 45)',
      '--app-hover-color': 'rgb(255, 255, 255)',
    },
  },
  {
    id: Theme.Light,
    name: 'settings.themes.light',
    splashImage: '/splash-light.jpg',
    cssVariables: {
      '--app-bg-primary': 'rgb(245, 245, 245)',
      '--app-bg-secondary': 'rgb(255, 255, 255)',
      '--app-surface': 'rgb(241, 241, 241)',
      '--app-card-active': 'rgb(250, 250, 250)',
      '--app-button-text': 'rgb(255, 255, 255)',
      '--app-text-primary': 'rgb(20, 20, 20)',
      '--app-text-secondary': 'rgb(108, 108, 108)',
      '--app-accent': 'rgb(198, 142, 110)',
      '--app-border-color': 'rgb(224, 224, 224)',
      '--app-hover-color': 'rgb(198, 142, 110)',
    },
  },
  {
    id: Theme.Grey,
    name: 'settings.themes.grey',
    splashImage: '/splash-grey.jpg',
    // Mid-grey workspace inspired by classic desktop photo editors (original palette).
    cssVariables: {
      '--app-bg-primary': 'rgb(74, 74, 74)',
      '--app-bg-secondary': 'rgb(88, 88, 88)',
      '--app-surface': 'rgb(66, 66, 66)',
      '--app-card-active': 'rgb(96, 96, 96)',
      '--app-button-text': 'rgb(32, 32, 32)',
      '--app-text-primary': 'rgb(235, 235, 235)',
      '--app-text-secondary': 'rgb(175, 175, 175)',
      '--app-accent': 'rgb(200, 200, 200)',
      '--app-border-color': 'rgb(58, 58, 58)',
      '--app-hover-color': 'rgb(210, 210, 210)',
    },
  },
];

export const DEFAULT_THEME_ID = Theme.Dark;
