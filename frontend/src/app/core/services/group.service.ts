@Injectable({ providedIn: 'root' })
export class GroupService {
  private apiUrl = `${environment.apiUrl}/groups`;

  getGroups(): Observable<Group[]> { }
  getGroup(id: number): Observable<Group> { }
  createGroup(dto: CreateGroupDto): Observable<Group> { }
  updateGroup(id: number, dto: Partial<CreateGroupDto>): Observable<Group> { }
  deleteGroup(id: number): Observable<void> { }
}