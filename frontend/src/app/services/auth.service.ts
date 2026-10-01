import { Injectable, Inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { isPlatformBrowser } from '@angular/common';
import { JwtHelperService } from '@auth0/angular-jwt';

@Injectable({ providedIn: 'root' })
export class AuthService {
    private apiUrl = '/api';
    private tokenKey = 'jwt_token';
    private isAuthenticatedSubject = new BehaviorSubject<boolean>(false);
    private roleSubject = new BehaviorSubject<string | null>(null);
    private isBrowser: boolean;

    constructor(
        private http: HttpClient,
        private jwtHelper: JwtHelperService,
        @Inject(PLATFORM_ID) platformId: Object
    ) {
        this.isBrowser = isPlatformBrowser(platformId);
        if (this.isBrowser) {
            const token = this.getToken();
            this.isAuthenticatedSubject.next(!!token && !this.jwtHelper.isTokenExpired(token));
            this.roleSubject.next(this.getRoleFromToken());
        }
    }

    login(username: string, password: string): Observable<any> {
        return this.http.post(`${this.apiUrl}/login`, { username, password }).pipe(
            tap((res: any) => {
                if (this.isBrowser) {
                    localStorage.setItem(this.tokenKey, res.token);
                    this.isAuthenticatedSubject.next(true);
                    this.roleSubject.next(res.role);
                }
            })
        );
    }

    logout() {
        if (this.isBrowser) {
            localStorage.removeItem(this.tokenKey);
            this.isAuthenticatedSubject.next(false);
            this.roleSubject.next(null);
        }
    }

    isAuthenticated(): Observable<boolean> {
        return this.isAuthenticatedSubject.asObservable();
    }

    getRole(): Observable<string | null> {
        return this.roleSubject.asObservable();
    }

    getToken(): string | null {
        return this.isBrowser ? localStorage.getItem(this.tokenKey) : null;
    }

    private getRoleFromToken(): string | null {
        const token = this.getToken();
        if (!token) return null;
        try {
            const decoded = this.jwtHelper.decodeToken(token);
            return decoded?.role || null;
        } catch {
            return null;
        }
    }
}
