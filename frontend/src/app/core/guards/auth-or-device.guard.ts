import { CanActivateFn, Router } from '@angular/router';
import { inject } from '@angular/core';
import { FirebaseAuthService } from '../services/firebase-auth.service';
import { toObservable } from '@angular/core/rxjs-interop';
import { filter, firstValueFrom, timeout, catchError, of } from 'rxjs';

export const authOrDeviceGuard: CanActivateFn = async (route, state) => {
  const router = inject(Router);
  const authService = inject(FirebaseAuthService);

  // 1. Check if paired device token exists in localStorage
  const deviceToken = localStorage.getItem('kids_tasker_device_token');
  if (deviceToken) {
    return true;
  }

  // 2. Wait for Firebase Auth initialization if not ready yet
  if (!authService.isInitialized()) {
    try {
      await firstValueFrom(
        toObservable(authService.isInitialized).pipe(
          filter(initialized => initialized === true),
          timeout(2500),
          catchError(() => of(true))
        )
      );
    } catch {}
  }

  // 3. Check if parent user is logged in
  if (authService.currentUser) {
    return true;
  }

  // 4. Block access and redirect unpaired & unauthenticated visitors to pairing
  return router.createUrlTree(['/pairing']);
};
