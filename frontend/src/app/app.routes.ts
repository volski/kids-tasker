import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./kids-board/kids-board.component').then(m => m.KidsBoardComponent),
  },
  {
    path: 'parent',
    loadComponent: () =>
      import('./parent/parent-shell/parent-shell.component').then(m => m.ParentShellComponent),
  },
  { path: '**', redirectTo: '' },
];
