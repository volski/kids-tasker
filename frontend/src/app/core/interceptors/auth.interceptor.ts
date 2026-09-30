import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { FirebaseAuthService } from '../services/firebase-auth.service';
import { from, switchMap } from 'rxjs';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(FirebaseAuthService);
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
      return next(cloned);
    })
  );
};
