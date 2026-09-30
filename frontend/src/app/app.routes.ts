import { Routes } from '@angular/router';
import { KidsBoardComponent } from './kids-board/kids-board.component';
import { authOrDeviceGuard } from './core/guards/auth-or-device.guard';

export const routes: Routes = [
  { path: '', component: KidsBoardComponent, canActivate: [authOrDeviceGuard] },
  { 
    path: 'login', 
    loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent) 
  },
  { 
    path: 'pair', 
    loadComponent: () => import('./auth/login/login.component').then(m => m.LoginComponent) 
  },
  { 
    path: 'pairing', 
    loadComponent: () => import('./device-pairing/device-pairing.component').then(m => m.DevicePairingComponent) 
  },
  { 
    path: 'parent', 
    canActivate: [authOrDeviceGuard],
    loadComponent: () => import('./parent/parent-shell/parent-shell.component').then(m => m.ParentShellComponent),
    children: [
      { path: '', redirectTo: 'status', pathMatch: 'full' },
      { path: 'status', loadComponent: () => import('./parent/status-tab/status-tab.component').then(m => m.StatusTabComponent) },
      { path: 'manage', loadComponent: () => import('./parent/manage-tab/manage-tab.component').then(m => m.ManageTabComponent) },
      { path: 'history', loadComponent: () => import('./parent/history-tab/history-tab.component').then(m => m.HistoryTabComponent) },
      { path: 'hass', loadComponent: () => import('./parent/hass-tab/hass-tab.component').then(m => m.HassTabComponent) },
      { path: 'settings', loadComponent: () => import('./parent/settings-tab/settings-tab.component').then(m => m.SettingsTabComponent) },
      { path: 'devices', loadComponent: () => import('./parent/devices-tab/devices-tab.component').then(m => m.DevicesTabComponent) }
    ]
  },
  { path: '**', redirectTo: '' }
];
