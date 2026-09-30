import { Routes } from '@angular/router';
import { KidsBoardComponent } from './kids-board/kids-board.component';

export const routes: Routes = [
  { path: '', component: KidsBoardComponent },
  { 
    path: 'parent', 
    loadComponent: () => import('./parent/parent-shell/parent-shell.component').then(m => m.ParentShellComponent),
    children: [
      { path: '', redirectTo: 'status', pathMatch: 'full' },
      { path: 'status', loadComponent: () => import('./parent/status-tab/status-tab.component').then(m => m.StatusTabComponent) },
      { path: 'manage', loadComponent: () => import('./parent/manage-tab/manage-tab.component').then(m => m.ManageTabComponent) },
      { path: 'history', loadComponent: () => import('./parent/history-tab/history-tab.component').then(m => m.HistoryTabComponent) },
      { path: 'hass', loadComponent: () => import('./parent/hass-tab/hass-tab.component').then(m => m.HassTabComponent) },
      { path: 'settings', loadComponent: () => import('./parent/settings-tab/settings-tab.component').then(m => m.SettingsTabComponent) }
    ]
  },
  { path: '**', redirectTo: '' }
];
