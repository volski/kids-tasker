import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface FamilyMember {
  uid: string;
  email: string;
  name: string;
}

export interface HouseholdInfo {
  householdId: string;
  name: string;
  joinCode: string;
  ownerUid: string;
  members: string[];
  memberProfiles: FamilyMember[];
}

@Injectable({ providedIn: 'root' })
export class HouseholdService {
  currentHousehold = signal<HouseholdInfo | null>(null);

  constructor(private http: HttpClient) {}

  getMyHousehold(): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.get<{ success: boolean; household: HouseholdInfo }>('/api/household/my-household').pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
        }
      })
    );
  }

  createHousehold(name: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/create', { name }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
        }
      })
    );
  }

  joinHousehold(joinCode: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/join', { joinCode }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
        }
      })
    );
  }
}
