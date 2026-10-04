@Pipe({ name: 'groupName', standalone: true })
export class GroupNamePipe implements PipeTransform {
  transform(groupId: number, groups: Group[]): string {
    return groups.find(g => g.id === groupId)?.displayName ?? 'Неизвестно';
  }
}