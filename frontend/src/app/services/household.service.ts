import { Injectable, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap } from 'rxjs';

export interface FamilyMember {
  uid: string;
  email: string;
  name: string;
  role?: 'owner' | 'member' | 'pending';
  joinedAt?: string;
}

export interface HouseholdInfo {
  householdId: string;
  name: string;
  joinCode: string;
  ownerUid: string;
  createdAt?: string;
  members: string[];
  pendingMembers?: string[];
  memberProfiles: FamilyMember[];
  pendingMemberProfiles?: FamilyMember[];
  isPending?: boolean;
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
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }

  createHousehold(name: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/create', { name }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }

  joinHousehold(joinCode: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/join', { joinCode }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }

  approveMember(targetUid: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/approve-member', { targetUid }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }

  rejectMember(targetUid: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/reject-member', { targetUid }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }

  leaveHousehold(): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/leave', {}).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }

  removeMember(targetUid: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.delete<{ success: boolean; household: HouseholdInfo }>(`/api/household/members/${targetUid}`).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }

  renameHousehold(name: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/rename', { name }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }

  transferOwnership(newOwnerUid: string): Observable<{ success: boolean; household: HouseholdInfo }> {
    return this.http.post<{ success: boolean; household: HouseholdInfo }>('/api/household/transfer-owner', { newOwnerUid }).pipe(
      tap(res => {
        if (res && res.household) {
          this.currentHousehold.set(res.household);
          if (res.household.householdId) localStorage.setItem('kids_tasker_household_id', res.household.householdId);
        }
      })
    );
  }
}
