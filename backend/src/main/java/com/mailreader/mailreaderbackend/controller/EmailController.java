package com.mailreader.mailreaderbackend.controller;

import com.mailreader.mailreaderbackend.dto.EmailAccountDto;
import com.mailreader.mailreaderbackend.dto.EmailDetailDto;
import com.mailreader.mailreaderbackend.dto.EmailSummaryDto;
import com.mailreader.mailreaderbackend.service.EmailService;
import jakarta.mail.MessagingException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.io.IOException;
import java.util.List;
import java.util.NoSuchElementException;

@RestController
@RequestMapping("/api/emails")
@CrossOrigin(origins = "*")
public class EmailController {

    private final EmailService emailService;

    public EmailController(EmailService emailService) {
        this.emailService = emailService;
    }

    @GetMapping
    public ResponseEntity<List<EmailSummaryDto>> listEmails(
            @RequestParam String host,
            @RequestParam(required = false) Integer port,
            @RequestParam String username,
            @RequestParam String password,
            @RequestParam(defaultValue = "imaps") String protocol,
            @RequestParam(defaultValue = "INBOX") String folder,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size) throws MessagingException {

        EmailAccountDto account = buildAccount(host, port, username, password, protocol, folder);
        return ResponseEntity.ok(emailService.listEmails(account, page, size));
    }

    @GetMapping("/{messageNumber}")
    public ResponseEntity<EmailDetailDto> getEmail(
            @PathVariable int messageNumber,
            @RequestParam String host,
            @RequestParam(required = false) Integer port,
            @RequestParam String username,
            @RequestParam String password,
            @RequestParam(defaultValue = "imaps") String protocol,
            @RequestParam(defaultValue = "INBOX") String folder) throws MessagingException, IOException {

        EmailAccountDto account = buildAccount(host, port, username, password, protocol, folder);
        return ResponseEntity.ok(emailService.getEmail(account, messageNumber));
    }

    @DeleteMapping("/{messageNumber}")
    public ResponseEntity<Void> deleteEmail(
            @PathVariable int messageNumber,
            @RequestParam String host,
            @RequestParam(required = false) Integer port,
            @RequestParam String username,
            @RequestParam String password,
            @RequestParam(defaultValue = "imaps") String protocol,
            @RequestParam(defaultValue = "INBOX") String folder) throws MessagingException {

        EmailAccountDto account = buildAccount(host, port, username, password, protocol, folder);
        emailService.deleteEmail(account, messageNumber);
        return ResponseEntity.noContent().build();
    }

    private EmailAccountDto buildAccount(String host, Integer port, String username, String password,
                                         String protocol, String folder) {
        EmailAccountDto account = new EmailAccountDto();
        account.setHost(host);
        account.setPort(port);
        account.setUsername(username);
        account.setPassword(password);
        account.setProtocol(protocol);
        account.setFolder(folder);
        return account;
    }

    @ExceptionHandler(MessagingException.class)
    public ResponseEntity<String> handleMessagingException(MessagingException ex) {
        return ResponseEntity.badRequest().body("Erro de comunicação com o servidor de e-mail: " + ex.getMessage());
    }

    @ExceptionHandler(NoSuchElementException.class)
    public ResponseEntity<String> handleNotFound(NoSuchElementException ex) {
        return ResponseEntity.status(404).body(ex.getMessage());
    }
}
