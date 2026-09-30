import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface FamilyMember {
  uid: string;
  email: string;
  name: string;
  role?: 'owner' | 'member';
  joinedAt?: string;
}

export interface HouseholdInfo {
  householdId: string;
  name: string;
  joinCode: string;
  ownerUid: string;
  createdAt?: string;
  members: string[];
  memberProfiles: FamilyMember[];
  isConfigured?: boolean;
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

  leaveHousehold(): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/leave', {}).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
        }
      })
    );
  }

  removeMember(targetUid: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.delete<{ success: boolean; household: HouseholdInfo }>(`/api/household/members/${targetUid}`).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
        }
      })
    );
  }

  renameHousehold(name: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/rename', { name }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
        }
      })
    );
  }

  transferOwnership(newOwnerUid: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/transfer-owner', { newOwnerUid }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
        }
      })
    );
  }
}
