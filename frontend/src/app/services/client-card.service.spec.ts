import { TestBed } from '@angular/core/testing';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ClientCardService } from './client-card.service';

describe('ClientCardService', () => {
  let service: ClientCardService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [HttpClientTestingModule],
      providers: [ClientCardService],
    });
    service = TestBed.inject(ClientCardService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  it('searchCards отправляет q', () => {
    service.searchCards('8C8A').subscribe();
    const req = httpMock.expectOne(r => r.url === '/api/cards/search');
    expect(req.request.params.get('q')).toBe('8C8A');
    req.flush([]);
  });

  it('topUpFromPost отправляет postId и amount', () => {
    service.topUpFromPost('8C8ADC80', '3', 150).subscribe();
    const req = httpMock.expectOne('/api/cards/8C8ADC80/topup-from-post');
    expect(req.request.body).toEqual({ postId: '3', amount: 150 });
    req.flush({ card: '8C8ADC80', balance: 150 } as any);
  });
});