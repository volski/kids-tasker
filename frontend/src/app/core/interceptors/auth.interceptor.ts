import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { FirebaseAuthService } from '../services/firebase-auth.service';
import { from, switchMap, catchError, throwError } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(FirebaseAuthService);
  const router = inject(Router);
  const deviceToken = localStorage.getItem('kids_tasker_device_token');

  return from(authService.getIdToken()).pipe(
    switchMap(idToken => {
      let headers = req.headers;

      if (idToken) {
        headers = headers.set('Authorization', `Bearer ${idToken}`);
      } else if (deviceToken) {
        headers = headers.set('X-Device-Token', deviceToken);
      }

      const cloned = req.clone({ headers });
      return next(cloned).pipe(
        catchError((error: HttpErrorResponse) => {
          // Handle 401 Unauthorized / Token Expiration / Device Revocation
          if (error.status === 401) {
            if (idToken) {
              // Attempt to force refresh the token once and retry
              return from(authService.getIdToken(true)).pipe(
                switchMap(newToken => {
                  if (newToken && newToken !== idToken) {
                    const retryReq = req.clone({
                      headers: req.headers.set('Authorization', `Bearer ${newToken}`)
                    });
                    return next(retryReq);
                  }
                  // Token refresh failed or user logged out -> redirect to login
                  router.navigate(['/login']);
                  return throwError(() => error);
                })
              );
            } else if (deviceToken || error.error?.code === 'DEVICE_REVOKED') {
              localStorage.removeItem('kids_tasker_device_token');
              router.navigate(['/pairing']);
              return throwError(() => error);
            }
          }
          return throwError(() => error);
        })
      );
    })
  );
};
